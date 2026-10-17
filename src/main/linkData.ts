// Lookups behind the link verdicts (MEGA_PROMPT §5.2, PLAN.md decision 20). None of them loads
// the page: Safe Browsing gets the URL with secrets stripped; RDAP, DNS and the certificate logs
// get only the domain; the threat feeds are downloaded whole and matched on the Mac, so nothing
// about the user's links leaves for them. Results are cached for an hour (in memory).
// Chalk takes over the feeds and RDAP as features in milestone 6; until then (and whenever Chalk
// is down, §5.9) these direct calls are the path.

import { promises as dns } from 'node:dns'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A small TTL cache of promises, so concurrent requests for one key share one lookup. */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>()
  constructor(
    private ttlMs: number,
    private max = 5000
  ) {}

  get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.map.get(key)
    if (hit && now - hit.at < this.ttlMs) return hit.value
    const value = load()
    // A failed lookup isn't cached: the next request tries again.
    value.catch(() => this.map.delete(key))
    this.map.set(key, { at: now, value })
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
    return value
  }

  clear(): void {
    this.map.clear()
  }
}

/** Runs at most `n` tasks at once, so a page with 100 domains doesn't fire 100 lookups. */
export function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    active--
    queue.shift()?.()
  }
  return (task) =>
    new Promise((resolve, reject) => {
      const run = (): void => {
        active++
        task().then(resolve, reject).finally(next)
      }
      if (active < n) run()
      else queue.push(run)
    })
}

// ---- Google Safe Browsing v4 (threatMatches:find) ----

export interface SafeBrowsingResult {
  match: boolean
  threat?: string
}

const sbCache = new TtlCache<SafeBrowsingResult>(HOUR)

async function safeBrowsingBatch(key: string, urls: string[]): Promise<Map<string, string>> {
  const res = await fetch(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        client: { clientId: 'aegis', clientVersion: '0.1.0' },
        threatInfo: {
          threatTypes: [
            'MALWARE',
            'SOCIAL_ENGINEERING',
            'UNWANTED_SOFTWARE',
            'POTENTIALLY_HARMFUL_APPLICATION'
          ],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url }))
        }
      })
    }
  )
  if (!res.ok) throw new Error(`Safe Browsing HTTP ${res.status}`)
  const body = (await res.json()) as {
    matches?: Array<{ threatType: string; threat: { url: string } }>
  }
  return new Map((body.matches ?? []).map((m) => [m.threat.url, m.threatType]))
}

/**
 * Looks up stripped URLs, 500 per request (the API's limit), each answer cached for an hour.
 * Returns null when no key is set.
 */
export function safeBrowsing(urls: string[]): Map<string, Promise<SafeBrowsingResult>> | null {
  const key = process.env.SAFE_BROWSING_KEY?.trim()
  if (!key) return null
  const out = new Map<string, Promise<SafeBrowsingResult>>()
  const missing: string[] = []
  const pending = new Map<string, (r: SafeBrowsingResult) => void>()
  const failed = new Map<string, (e: unknown) => void>()
  for (const url of new Set(urls)) {
    out.set(
      url,
      sbCache.get(url, () => {
        missing.push(url)
        return new Promise<SafeBrowsingResult>((resolve, reject) => {
          pending.set(url, resolve)
          failed.set(url, reject)
        })
      })
    )
  }
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500)
    safeBrowsingBatch(key, chunk).then(
      (matches) => {
        for (const url of chunk) {
          const threat = matches.get(url)
          pending.get(url)?.(threat ? { match: true, threat } : { match: false })
        }
      },
      (err) => {
        for (const url of chunk) failed.get(url)?.(err)
      }
    )
  }
  return out
}

// ---- Threat feeds: URLhaus (online URLs) and OpenPhish (community feed) ----

export const FEEDS = [
  { name: 'URLhaus', url: 'https://urlhaus.abuse.ch/downloads/csv_online/' },
  { name: 'OpenPhish', url: 'https://openphish.com/feed.txt' }
] as const

/** Lower-case scheme and host, no default port, no trailing slash: how feed URLs are compared. */
export function normalizeFeedUrl(href: string): string | null {
  try {
    const u = new URL(href.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.toString().replace(/\/$/, '').toLowerCase()
  } catch {
    return null
  }
}

/** URLs from a feed body: URLhaus's CSV (third column) or OpenPhish's one URL per line. */
export function parseFeed(body: string): string[] {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (t.startsWith('"')) {
      const cols = t.split('","')
      if (cols[2]) out.push(cols[2])
    } else if (/^https?:\/\//i.test(t)) out.push(t)
  }
  return out
}

export interface FeedMatch {
  /** The feed listing this exact URL. */
  url: string | null
  /** A feed listing other URLs on this host. */
  host: string | null
}

export class ThreatFeeds {
  private urls = new Map<string, string>()
  private hosts = new Map<string, string>()
  loadedAt: number | null = null
  counts: Record<string, number> = {}

  add(feed: string, urls: string[]): void {
    let n = 0
    for (const raw of urls) {
      const norm = normalizeFeedUrl(raw)
      if (!norm) continue
      this.urls.set(norm, feed)
      this.hosts.set(new URL(norm).hostname, feed)
      n++
    }
    this.counts[feed] = n
  }

  /** Swaps in freshly downloaded feeds; keeps the old data for any feed that failed. */
  replace(next: ThreatFeeds): void {
    for (const [feed, n] of Object.entries(next.counts)) {
      for (const [u, f] of [...this.urls]) if (f === feed) this.urls.delete(u)
      for (const [h, f] of [...this.hosts]) if (f === feed) this.hosts.delete(h)
      this.counts[feed] = n
    }
    for (const [u, f] of next.urls) this.urls.set(u, f)
    for (const [h, f] of next.hosts) this.hosts.set(h, f)
    this.loadedAt = Date.now()
  }

  match(href: string): FeedMatch {
    const norm = normalizeFeedUrl(href)
    if (!norm) return { url: null, host: null }
    return {
      url: this.urls.get(norm) ?? null,
      host: this.hosts.get(new URL(norm).hostname) ?? null
    }
  }

  get ready(): boolean {
    return this.loadedAt !== null
  }
}

export const threatFeeds = new ThreatFeeds()

/** Downloads every feed (each on its own; one failing keeps the others). */
export async function refreshFeeds(
  log: (text: string, ok: boolean) => void = () => {}
): Promise<void> {
  const next = new ThreatFeeds()
  await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const res = await fetch(f.url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        next.add(f.name, parseFeed(await res.text()))
        log(`feed loaded name=${f.name} urls=${next.counts[f.name]}`, true)
      } catch (err) {
        log(`feed failed name=${f.name} error=${err instanceof Error ? err.message : err}`, false)
      }
    })
  )
  threatFeeds.replace(next)
}

// ---- RDAP: when the domain was registered ----

const rdapLimit = limiter(4)
const rdapCache = new TtlCache<number | null>(HOUR)
let bootstrap: { at: number; servers: Promise<Map<string, string>> } | null = null

/** IANA's RDAP bootstrap file: which registry server answers for each TLD. */
function rdapServers(): Promise<Map<string, string>> {
  if (bootstrap && Date.now() - bootstrap.at < DAY) return bootstrap.servers
  const servers = fetch('https://data.iana.org/rdap/dns.json', {
    signal: AbortSignal.timeout(10_000)
  })
    .then((r) => {
      if (!r.ok) throw new Error(`IANA bootstrap HTTP ${r.status}`)
      return r.json() as Promise<{ services: Array<[string[], string[]]> }>
    })
    .then((j) => {
      const map = new Map<string, string>()
      for (const [tlds, urls] of j.services) {
        const base = urls.find((u) => u.startsWith('https://')) ?? urls[0]
        for (const tld of tlds) map.set(tld.toLowerCase(), base.endsWith('/') ? base : `${base}/`)
      }
      return map
    })
  servers.catch(() => {
    bootstrap = null
  })
  bootstrap = { at: Date.now(), servers }
  return servers
}

/** The registration date from an RDAP domain response, or null if it has none. */
export function registrationDate(body: unknown): Date | null {
  const events = (body as { events?: Array<{ eventAction?: string; eventDate?: string }> })?.events
  const reg = events?.find((e) => e.eventAction === 'registration')?.eventDate
  const d = reg ? new Date(reg) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

/**
 * Days since `domain` was registered. Null when its registry has no RDAP server or doesn't say
 * (many country-code TLDs); throws on network errors.
 */
export function domainAgeDays(domain: string, now = Date.now()): Promise<number | null> {
  return rdapCache.get(domain, () =>
    rdapLimit(async () => {
      const servers = await rdapServers()
      const base = servers.get(domain.split('.').pop() ?? '')
      if (!base) return null
      const res = await fetch(`${base}domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json' },
        signal: AbortSignal.timeout(5000)
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`)
      const reg = registrationDate(await res.json())
      return reg ? (now - reg.getTime()) / DAY : null
    })
  )
}

// ---- DNS ----

export interface DnsFacts {
  exists: boolean
  fastFlux: boolean
}

const dnsCache = new TtlCache<DnsFacts>(HOUR)

/**
 * Fast flux: many A records with short TTLs spread over unrelated networks. Ordinary CDNs return a
 * few addresses from one or two /16s.
 */
export function looksFastFlux(records: Array<{ address: string; ttl: number }>): boolean {
  if (records.length < 5) return false
  if (records.some((r) => r.ttl > 300)) return false
  const nets = new Set(records.map((r) => r.address.split('.').slice(0, 2).join('.')))
  return nets.size >= 4
}

export function dnsFacts(host: string): Promise<DnsFacts> {
  return dnsCache.get(host, async () => {
    try {
      const a = await dns.resolve4(host, { ttl: true })
      return { exists: true, fastFlux: looksFastFlux(a) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') throw err
    }
    try {
      await dns.resolve6(host)
      return { exists: true, fastFlux: false }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOTFOUND' || code === 'ENODATA') return { exists: false, fastFlux: false }
      throw err
    }
  })
}

// ---- Certificate-transparency logs (Cert Spotter) ----

const ctLimit = limiter(2)
const ctCache = new TtlCache<number | null>(HOUR)

/**
 * Days since the oldest still-valid certificate for `domain` was issued, from Cert Spotter's
 * free API (it lists unexpired certificates only). A domain whose oldest valid certificate is a
 * few days old has only just set up HTTPS. Null when there are none. Sends only the domain.
 */
export function certAgeDays(domain: string, now = Date.now()): Promise<number | null> {
  return ctCache.get(domain, () =>
    ctLimit(async () => {
      const headers: Record<string, string> = {}
      if (process.env.CERTSPOTTER_API_KEY) {
        headers.authorization = `Bearer ${process.env.CERTSPOTTER_API_KEY}`
      }
      const res = await fetch(
        `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true`,
        { headers, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) throw new Error(`Cert Spotter HTTP ${res.status}`)
      const certs = (await res.json()) as Array<{ not_before?: string }>
      return oldestCertAgeDays(certs, now)
    })
  )
}

export function oldestCertAgeDays(
  certs: Array<{ not_before?: string }>,
  now = Date.now()
): number | null {
  const times = certs
    .map((c) => (c.not_before ? Date.parse(c.not_before) : NaN))
    .filter((t) => Number.isFinite(t))
  if (times.length === 0) return null
  return (now - Math.min(...times)) / DAY
}

/** Clears every cache (tests, and Settings when the user asks to re-check). */
export function clearLinkCaches(): void {
  sbCache.clear()
  rdapCache.clear()
  dnsCache.clear()
  ctCache.clear()
}
