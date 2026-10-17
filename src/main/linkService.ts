// Turns a page's links into verdicts (MEGA_PROMPT §5.2, architectural.md §4.3) and records what
// happened at each click. Tier 1 runs at once; the lookups (Safe Browsing, feeds, RDAP, DNS,
// certificate logs) get TIMEOUTS_MS.linkLookups, and whatever hasn't finished is marked `timeout`
// and keeps running into the cache, so a click a moment later sees the full answer.

import { TIMEOUTS_MS } from '@shared/constants'
import type { ClickRequest, PageRequest, PageResponse } from '@shared/bridge'
import type {
  CheckRun,
  CheckState,
  LinkVerdict,
  PageSnapshot,
  ScanAction,
  ScanReport,
  Verdict
} from '@shared/types'
import { linkHeadline, VERDICTS } from '@shared/verdicts'
import {
  certAgeDays,
  dnsFacts,
  domainAgeDays,
  safeBrowsing,
  threatFeeds,
  type SafeBrowsingResult
} from './linkData'
import {
  parseLink,
  registeredDomain,
  schemeReasons,
  scoreLink,
  stripSecrets,
  tier1,
  unwrapRedirects,
  type LinkCheckKey,
  type LinkFacts
} from './links'

export interface LinkServiceDeps {
  isPaused(): boolean
  trustedDomains(): Set<string>
  putScan(report: ScanReport): void
  /** A line for the scan log. */
  log(level: 'block' | 'warn' | 'allow' | null, text: string): void
  /** The open tab's counts changed (for the panel's "This page"). */
  onPage(page: PageSnapshot | null): void
  /** A malicious link was stopped at the click (the panel auto-pops). */
  onBlocked(v: LinkVerdict): void
  /** Injected so tests run without the network. */
  lookups?: Lookups
}

export interface Lookups {
  safeBrowsing(urls: string[]): Map<string, Promise<SafeBrowsingResult>> | null
  feeds(href: string): { url: string | null; host: string | null } | null
  domainAgeDays(domain: string): Promise<number | null>
  dnsFacts(host: string): Promise<{ exists: boolean; fastFlux: boolean }>
  certAgeDays(domain: string): Promise<number | null>
}

const LIVE: Lookups = {
  safeBrowsing,
  feeds: (href) => (threatFeeds.ready ? threatFeeds.match(href) : null),
  domainAgeDays: (d) => domainAgeDays(d),
  dnsFacts,
  certAgeDays: (d) => certAgeDays(d)
}

const RANK = (v: LinkVerdict): number => VERDICTS[v.verdict].rank * 1000 + v.score

/** Where a page was seen, for people: "Gmail", "Outlook" or "Chrome". */
export function seenIn(pageUrl: string): string {
  const host = parseLink(pageUrl)?.host ?? ''
  if (host === 'mail.google.com') return 'Gmail'
  if (/^outlook\.(live|office|office365)\.com$/.test(host)) return 'Outlook'
  return 'Chrome'
}

/** One lookup with its state: ok, error, or still running at the deadline (timeout). */
interface Pending<T> {
  promise: Promise<T>
  state: CheckState
  value?: T
}

function track<T>(promise: Promise<T>): Pending<T> {
  const p: Pending<T> = { promise, state: 'timeout' }
  promise.then(
    (value) => {
      p.state = 'ok'
      p.value = value
    },
    () => {
      p.state = 'error'
    }
  )
  return p
}

/** Everything known about one link target, kept for its report. */
interface Evaluated {
  verdict: LinkVerdict
  facts: LinkFacts
  /** The destination checked, when the link is a redirect wrapper. */
  destination: string | null
}

interface TabPage {
  url: string
  links: Map<string, Evaluated>
}

export class LinkService {
  private tabs = new Map<number, TabPage>()
  /** Each click keeps the verdict the user saw; a later decision changes only the action. */
  private clicks = new Map<string, { createdAt: string; evaluated: Evaluated }>()
  private lookups: Lookups

  constructor(private deps: LinkServiceDeps) {
    this.lookups = deps.lookups ?? LIVE
  }

  /** POST /page: verdicts for every link, waiting at most the lookup budget. */
  async check(req: PageRequest): Promise<PageResponse> {
    if (this.deps.isPaused()) return { paused: true, links: [], scamText: null, sender: null }
    const started = Date.now()
    const evaluated = await this.evaluate(
      req.links,
      req.pageUrl,
      req.urgent ? TIMEOUTS_MS.linkAtClick : TIMEOUTS_MS.linkLookups
    )
    const checkedMs = Date.now() - started
    for (const e of evaluated.values()) e.verdict.checkedMs = checkedMs
    this.remember(req.tabId, req.pageUrl, evaluated)
    return {
      paused: false,
      links: [...evaluated.values()].map((e) => e.verdict),
      scamText: null,
      sender: null
    }
  }

  /** POST /click: records the click as a Links entry, then updates it when the user decides. */
  async click(req: ClickRequest): Promise<void> {
    const prior = this.clicks.get(req.clickId)
    let e = prior?.evaluated ?? this.find(req.tabId, req.href)
    if (!e) {
      const fresh = await this.evaluate([{ href: req.href, text: req.linkText }], req.pageUrl, 0)
      e = fresh.get(req.href)
    }
    if (!e) return
    const v = e.verdict
    const action: ScanAction =
      req.decision === 'allowed' ? 'allowed' : req.decision === 'held' ? 'held' : 'blocked'
    const now = new Date().toISOString()
    const createdAt = prior?.createdAt ?? now
    this.clicks.set(req.clickId, { createdAt, evaluated: e })
    if (this.clicks.size > 500) this.clicks.delete(this.clicks.keys().next().value as string)

    const top = v.reasons[0]
    this.deps.putScan({
      id: req.clickId,
      kind: 'link',
      source: 'chrome',
      seenIn: seenIn(req.pageUrl),
      url: v.urlStripped,
      filename: null,
      fileKind: null,
      size: null,
      status: 'done',
      verdict: v.verdict,
      score: v.score,
      reason:
        v.verdict === 'clean' || !top
          ? 'No threats found'
          : top.text[0].toUpperCase() + top.text.slice(1),
      action,
      durationMs: Math.round(req.verdictMs),
      createdAt,
      updatedAt: now,
      summary: v.verdict === 'clean' ? 'No threats found' : linkHeadline(v),
      reasons: v.reasons,
      stage1: null,
      droid: null,
      indicators: {
        sha256: null,
        realType: null,
        claimedType: null,
        signature: null,
        size: null,
        firstSeen: createdAt
      },
      code: [],
      checks: checkRuns(e, req.trusted === true),
      sandbox: [],
      partial: Object.values(v.checks).some((s) => s === 'timeout' || s === 'error'),
      heldPath: null
    })
    const level = action === 'blocked' ? 'block' : action === 'held' ? 'warn' : 'allow'
    this.deps.log(
      v.verdict === 'clean' && action === 'allowed' ? null : level,
      `link click verdict=${v.verdict} domain=${v.domain || '-'} score=${v.score} action=${action}${req.trusted ? ' trusted=true' : ''}`
    )
    if (!prior && v.verdict === 'malicious' && action !== 'allowed') this.deps.onBlocked(v)
  }

  /** Forget cached verdicts for a domain (after Trust this site, or removing a trusted site). */
  forgetDomain(domain: string): void {
    for (const page of this.tabs.values()) {
      for (const [href, e] of page.links) if (e.verdict.domain === domain) page.links.delete(href)
    }
  }

  // ---- internals ----

  private find(tabId: number | undefined, href: string): Evaluated | undefined {
    if (tabId !== undefined) return this.tabs.get(tabId)?.links.get(href)
    for (const page of this.tabs.values()) {
      const e = page.links.get(href)
      if (e) return e
    }
    return undefined
  }

  private remember(tabId: number, pageUrl: string, evaluated: Map<string, Evaluated>): void {
    let page = this.tabs.get(tabId)
    if (!page || page.url !== pageUrl) {
      page = { url: pageUrl, links: new Map() }
      this.tabs.set(tabId, page)
    }
    for (const [href, e] of evaluated) page.links.set(href, e)
    if (this.tabs.size > 50) this.tabs.delete(this.tabs.keys().next().value as number)
    this.deps.onPage(snapshot(page))
  }

  private async evaluate(
    links: Array<{ href: string; text: string }>,
    pageUrl: string,
    waitMs: number
  ): Promise<Map<string, Evaluated>> {
    const trusted = this.deps.trustedDomains()
    const pageDomain = registeredDomain(pageUrl)
    const unique = new Map<string, string>()
    for (const l of links) if (!unique.has(l.href)) unique.set(l.href, l.text)

    // Every URL to check: each link, plus the destination of any redirect wrapper.
    const targets = new Map<string, string[]>()
    for (const href of unique.keys()) {
      targets.set(href, schemeReasons(href) ? [href] : [href, ...unwrapRedirects(href)])
    }
    const all = [...new Set([...targets.values()].flat())]
    const parsed = new Map(all.map((u) => [u, parseLink(u)]))

    const sb = this.lookups.safeBrowsing([
      ...new Set(all.filter((u) => parsed.get(u)).map((u) => stripSecrets(u)))
    ])
    const sbTracked = new Map<string, Pending<SafeBrowsingResult>>()
    if (sb) for (const [u, p] of sb) sbTracked.set(u, track(p))

    // Domain lookups only where they can change the verdict: not the page's own site, not
    // trusted or known domains, not IPs, not shorteners (they're Unknown regardless).
    const rdap = new Map<string, Pending<number | null>>()
    const dnsT = new Map<string, Pending<{ exists: boolean; fastFlux: boolean }>>()
    const ct = new Map<string, Pending<number | null>>()
    for (const link of parsed.values()) {
      if (!link || link.isIp || !link.domain.includes('.')) continue
      const t1 = tier1(link)
      if (t1.known || t1.hiddenDestination || trusted.has(link.domain)) continue
      if (link.domain === pageDomain) continue
      if (!rdap.has(link.domain)) {
        const age = this.lookups.domainAgeDays(link.domain)
        rdap.set(link.domain, track(age))
        // Certificate logs: when RDAP has no date or says the domain is young.
        const certs = age.then(
          (d) => (d == null || d < 90 ? this.lookups.certAgeDays(link.domain) : null),
          () => this.lookups.certAgeDays(link.domain)
        )
        ct.set(link.domain, track(certs))
      }
      if (!dnsT.has(link.host)) dnsT.set(link.host, track(this.lookups.dnsFacts(link.host)))
    }

    const everything = [
      ...[...sbTracked.values()].map((p) => p.promise),
      ...[...rdap.values()].map((p) => p.promise),
      ...[...dnsT.values()].map((p) => p.promise),
      ...[...ct.values()].map((p) => p.promise)
    ]
    if (everything.length > 0 && waitMs > 0) {
      await Promise.race([
        Promise.allSettled(everything),
        new Promise((r) => setTimeout(r, waitMs))
      ])
    }
    // Let settled promises run their `then` before reading states.
    await new Promise((r) => setImmediate(r))

    const out = new Map<string, Evaluated>()
    for (const [href, text] of unique) {
      let worst: Evaluated | null = null
      for (const target of targets.get(href) ?? [href]) {
        const e = this.scoreTarget(
          target,
          text,
          trusted,
          parsed,
          sbTracked,
          sb !== null,
          rdap,
          dnsT,
          ct
        )
        // Ties go to the destination: it's where the link really leads.
        if (!worst || RANK(e.verdict) >= RANK(worst.verdict)) {
          worst = { ...e, destination: target === href ? null : target }
        }
      }
      if (!worst) continue
      const v = worst.verdict
      if (worst.destination) {
        const via = parseLink(href)?.domain ?? ''
        v.reasons = [
          ...v.reasons,
          { code: 'redirect', text: `passes through ${via} to ${v.domain}`, weight: 0, hard: false }
        ]
      }
      out.set(href, { ...worst, verdict: { ...v, url: href } })
    }
    return out
  }

  private scoreTarget(
    target: string,
    text: string,
    trusted: Set<string>,
    parsed: Map<string, ReturnType<typeof parseLink>>,
    sb: Map<string, Pending<SafeBrowsingResult>>,
    sbConfigured: boolean,
    rdap: Map<string, Pending<number | null>>,
    dnsT: Map<string, Pending<{ exists: boolean; fastFlux: boolean }>>,
    ct: Map<string, Pending<number | null>>
  ): Omit<Evaluated, 'destination'> {
    const link = parsed.get(target)
    const facts: LinkFacts = {}
    const checks: Partial<Record<LinkCheckKey, CheckState>> = {}
    if (link) {
      const sbp = sb.get(stripSecrets(target))
      checks.safeBrowsing = sbConfigured ? (sbp?.state ?? 'skipped') : 'skipped'
      if (sbp?.value) facts.safeBrowsing = sbp.value
      const feed = this.lookups.feeds(target)
      checks.threatFeeds = feed ? 'ok' : 'skipped'
      if (feed) {
        facts.feedMatch = feed.url
        // A listing for another URL on the same host counts only for hosts that aren't trusted
        // or known: URLhaus lists malware hosted on GitHub, which doesn't make GitHub dangerous.
        facts.feedHost = trusted.has(link.domain) || tier1(link).known ? null : feed.host
      }
      const age = rdap.get(link.domain)
      checks.rdap = age?.state ?? 'skipped'
      if (age?.state === 'ok') facts.domainAgeDays = age.value
      const d = dnsT.get(link.host)
      checks.dns = d?.state ?? 'skipped'
      if (d?.state === 'ok') facts.dns = d.value
      const c = ct.get(link.domain)
      checks.certLogs = c?.state ?? 'skipped'
      if (c?.state === 'ok') facts.certAgeDays = c.value
    }
    const verdict = scoreLink({
      href: target,
      linkText: text,
      trusted: link ? trusted.has(link.domain) : false,
      facts,
      checks
    })
    return { verdict, facts }
  }
}

/** The panel's "This page": counts per verdict and the riskiest link. */
export function snapshot(page: TabPage): PageSnapshot {
  const counts: Record<Verdict, number> = { clean: 0, unknown: 0, suspicious: 0, malicious: 0 }
  let top: LinkVerdict | null = null
  for (const { verdict } of page.links.values()) {
    counts[verdict.verdict]++
    if (verdict.verdict !== 'clean' && (!top || RANK(verdict) > RANK(top))) top = verdict
  }
  return {
    url: stripSecrets(page.url),
    counts,
    top: top
      ? {
          domain: top.domain || top.urlStripped,
          reason: top.reasons[0]?.text ?? '',
          verdict: top.verdict
        }
      : null
  }
}

const CHECK_NAMES: Record<LinkCheckKey, string> = {
  tier1: 'Link rules',
  safeBrowsing: 'Google Safe Browsing',
  threatFeeds: 'Threat feeds (URLhaus, OpenPhish)',
  rdap: 'Domain age (RDAP)',
  dns: 'DNS records',
  certLogs: 'Certificate logs'
}

function ageText(days: number | null | undefined, what: string): string {
  if (days == null) return `no ${what}`
  const d = Math.round(days)
  if (d < 1) return 'today'
  if (d < 60) return `${d} day${d === 1 ? '' : 's'} ago`
  if (d < 730) return `${Math.round(d / 30)} months ago`
  return `${Math.round(d / 365)} years ago`
}

/** "Checks that ran" for a link's report. */
export function checkRuns(e: Pick<Evaluated, 'verdict' | 'facts'>, trusted: boolean): CheckRun[] {
  const { verdict: v, facts } = e
  const runs: CheckRun[] = []
  for (const key of Object.keys(CHECK_NAMES) as LinkCheckKey[]) {
    const state = v.checks[key]
    if (!state) continue
    const name = CHECK_NAMES[key]
    if (state === 'timeout') {
      runs.push({ name, state: 'warn', result: 'timed out' })
      continue
    }
    if (state === 'error') {
      runs.push({ name, state: 'fail', result: 'failed' })
      continue
    }
    if (state === 'skipped') {
      const why =
        key === 'safeBrowsing'
          ? 'no key'
          : key === 'threatFeeds'
            ? 'feeds not loaded'
            : trusted
              ? 'trusted site'
              : 'not needed'
      runs.push({ name, state: 'skipped', result: why })
      continue
    }
    switch (key) {
      case 'tier1': {
        const n = v.reasons.filter(
          (r) =>
            r.weight > 0 &&
            ![
              'safe_browsing',
              'threat_feed',
              'threat_feed_host',
              'domain_age',
              'cert_new',
              'dns_missing',
              'fast_flux'
            ].includes(r.code)
        ).length
        runs.push({ name, state: n ? 'warn' : 'ok', result: n ? `${n} flagged` : 'passed' })
        break
      }
      case 'safeBrowsing':
        runs.push(
          facts.safeBrowsing?.match
            ? { name, state: 'fail', result: facts.safeBrowsing.threat ?? 'match' }
            : { name, state: 'ok', result: 'no match' }
        )
        break
      case 'threatFeeds':
        runs.push(
          facts.feedMatch
            ? { name, state: 'fail', result: `listed (${facts.feedMatch})` }
            : facts.feedHost
              ? { name, state: 'warn', result: `site listed (${facts.feedHost})` }
              : { name, state: 'ok', result: 'no match' }
        )
        break
      case 'rdap': {
        const young = facts.domainAgeDays != null && facts.domainAgeDays < 30
        runs.push({
          name,
          state: young ? 'warn' : 'ok',
          result:
            facts.domainAgeDays == null
              ? 'no date'
              : `registered ${ageText(facts.domainAgeDays, 'date')}`
        })
        break
      }
      case 'dns':
        runs.push(
          !facts.dns?.exists
            ? { name, state: 'warn', result: 'doesn’t resolve' }
            : facts.dns.fastFlux
              ? { name, state: 'warn', result: 'fast-flux pattern' }
              : { name, state: 'ok', result: 'resolves' }
        )
        break
      case 'certLogs': {
        const fresh = facts.certAgeDays != null && facts.certAgeDays < 7
        runs.push({
          name,
          state: fresh ? 'warn' : 'ok',
          result:
            facts.certAgeDays == null
              ? 'no certificates'
              : `oldest valid ${ageText(facts.certAgeDays, 'certificate')}`
        })
        break
      }
    }
  }
  return runs
}
