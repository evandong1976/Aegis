// Link checks that need no network (MEGA_PROMPT §5.2, BUILD_PROMPT §4.2 item 2): URL parsing,
// secret stripping (§6 rule 11), redirect unwrapping, Tier 1 rules and the final verdict.
// Pure functions; the lookups (Safe Browsing, feeds, RDAP, DNS, certificate logs) live in
// linkData.ts and arrive here as `LinkFacts`. No link is ever opened (PLAN.md decision 20).

import { domainToUnicode } from 'node:url'
import { parse as parseDomain } from 'tldts'
import { ALWAYS_SCAN_EXTENSIONS } from '@shared/constants'
import type { CheckState, LinkVerdict, Reason } from '@shared/types'
import {
  BRANDS,
  KNOWN_DOMAINS,
  LURE_WORDS,
  REDIRECT_PARAMS,
  RISKY_TLDS,
  SHORTENERS
} from './linkLists'
import { combine } from './verdict'

// Private suffixes too: trusting `alice.github.io` must not trust every github.io site.
const TLDTS = { allowPrivateDomains: true } as const

export interface ParsedLink {
  url: URL
  /** Lower-case host without a trailing dot. */
  host: string
  /** Registered domain (eTLD+1), or the host for IPs and single-label hosts. */
  domain: string
  /** The registered domain without its public suffix: `paypal` for `paypal.co.uk`. */
  label: string
  subdomain: string
  suffix: string
  isIp: boolean
}

export function parseLink(href: string): ParsedLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  const p = parseDomain(host, TLDTS)
  return {
    url,
    host,
    domain: p.domain ?? host,
    label: p.domainWithoutSuffix ?? host,
    subdomain: p.subdomain ?? '',
    suffix: p.publicSuffix ?? '',
    isIp: p.isIp === true
  }
}

/** The registered domain a page or link belongs to: what "Trust this site" trusts. */
export function registeredDomain(hrefOrHost: string): string | null {
  const host = hrefOrHost.includes('://') ? parseLink(hrefOrHost)?.host : hrefOrHost.toLowerCase()
  if (!host) return null
  const p = parseDomain(host, TLDTS)
  return p.domain ?? (host || null)
}

// ---- Secret stripping (MEGA_PROMPT §6 rule 11) ----

const SECRET_PARAM =
  /^(token|access_?token|id_?token|refresh_?token|auth|authorization|code|otp|pin|key|api_?key|apikey|sig|signature|session|session_?id|sessionid|sid|ssid|jsessionid|phpsessid|password|passwd|pass|pwd|email|e-?mail|mail|user(name)?|login|nonce|secret|hash|ticket|t)$/i
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const JWT = /^[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}$/

/** True for values that look random enough to be a credential: long, mixed, few repeats. */
export function looksRandom(value: string): boolean {
  const v = decodeSafe(value)
  if (v.length < 20 || /\s/.test(v)) return false
  if (/^https?:/i.test(v)) return false
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(v)).length
  const unique = new Set(v).size
  return (classes >= 2 || /^[a-f0-9]{24,}$/i.test(v)) && unique >= 10
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * Removes what could identify the user before a URL leaves the Mac: query parameters that look
 * like tokens, session IDs, emails or codes, long random values, the fragment and any
 * `user:password@`. Everything else, path included, is kept so reputation lookups still match.
 */
export function stripSecrets(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return href
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${url.protocol}…`
  url.username = ''
  url.password = ''
  url.hash = ''
  for (const [name, value] of [...url.searchParams]) {
    const v = decodeSafe(value)
    if (SECRET_PARAM.test(name) || EMAIL.test(v) || JWT.test(v) || looksRandom(v)) {
      url.searchParams.delete(name)
    }
  }
  return url.toString()
}

// ---- Redirect wrappers ----

/**
 * The destination a redirect wrapper carries in its own URL (`google.com/url?q=…`,
 * `…safelinks.protection.outlook.com/?url=…`), followed up to three levels. Reading a parameter
 * needs no request. Returns [] when there is none.
 */
export function unwrapRedirects(href: string): string[] {
  const out: string[] = []
  let current = href
  for (let depth = 0; depth < 3; depth++) {
    let url: URL
    try {
      url = new URL(current)
    } catch {
      break
    }
    let next: string | null = null
    for (const name of REDIRECT_PARAMS) {
      const v = url.searchParams.get(name)
      if (v && /^https?:\/\//i.test(v.trim()) && parseLink(v.trim())) {
        next = v.trim()
        break
      }
    }
    if (!next || next === current) break
    out.push(next)
    current = next
  }
  return out
}

// ---- Lookalikes ----

/** Damerau-Levenshtein (optimal string alignment) distance, capped for speed. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

// Characters that pass for Latin letters: digit swaps and the common Cyrillic and Greek homoglyphs.
const CONFUSABLE: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ԁ: 'd',
  һ: 'h',
  ѕ: 's',
  ӏ: 'l',
  ο: 'o',
  α: 'a',
  ν: 'v',
  ι: 'i',
  κ: 'k',
  τ: 't',
  ρ: 'p'
}

/** Maps look-alike characters to the Latin letters they imitate: `paypa1` → `paypal`. */
export function skeleton(label: string): string {
  return [...label.toLowerCase()]
    .map((c) => CONFUSABLE[c] ?? c)
    .join('')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
}

function ownsBrand(brand: string, domain: string): boolean {
  return BRANDS[brand]?.includes(domain) ?? false
}

function sameOwner(a: string, b: string): boolean {
  return Object.values(BRANDS).some((owned) => owned.includes(a) && owned.includes(b))
}

/**
 * Brands that are everyday words: only an exact match or brand + lure word counts, never an edit
 * distance (`discovery.com` isn't imitating Discover) or a mention in a path.
 */
const WORD_BRANDS = new Set([
  'apple',
  'chase',
  'target',
  'discover',
  'signal',
  'steam',
  'zoom',
  'booking',
  'slack',
  'meta',
  'stripe',
  'kraken',
  'blockchain',
  'discord',
  'norton',
  'lloyds',
  'uber'
])

/** Which brand a registered-domain label imitates, if any. Never fires for the brand's own domains. */
export function lookalikeBrand(label: string, domain: string): string | null {
  if (KNOWN_DOMAINS.has(domain)) return null
  const unicode = domainToUnicode(label) || label
  const words = unicode
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean)
  const candidates = new Set([unicode.toLowerCase(), ...words])
  for (const brand of Object.keys(BRANDS)) {
    if (ownsBrand(brand, domain)) continue
    for (const word of candidates) {
      const sk = skeleton(word)
      if (sk === brand) return brand
      if (brand.length >= 5 && word.length >= 4 && !WORD_BRANDS.has(brand)) {
        const limit = brand.length >= 9 ? 2 : 1
        if (editDistance(sk, brand, limit) <= limit) return brand
      }
      // `paypalsecure`, `secure-paypal`: the brand glued to a lure word.
      if (brand.length >= 5 && sk !== brand && sk.includes(brand)) {
        const rest = sk.replace(brand, '')
        if (LURE_WORDS.has(rest)) return brand
      }
    }
    // The brand as one hyphen-separated word next to lure words: `paypal-secure-login`.
    if (words.includes(brand) && words.some((w) => LURE_WORDS.has(w))) return brand
  }
  return null
}

/**
 * A brand named in the subdomain (`paypal.com.account-check.xyz`), or in the path next to a
 * sign-in word (`/paypal/login`), while the registered domain is unrelated. A blog post about
 * PayPal (`/how-to-use-paypal`) doesn't count.
 */
function brandElsewhere(link: ParsedLink): string | null {
  if (KNOWN_DOMAINS.has(link.domain)) return null
  const sub = link.subdomain.toLowerCase().split(/[.-]+/)
  const path = decodeSafe(link.url.pathname)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  const signIn = path.some((w) => LURE_WORDS.has(w))
  for (const brand of Object.keys(BRANDS)) {
    if (brand.length < 4 || ownsBrand(brand, link.domain)) continue
    if (sub.includes(brand)) return brand
    if (signIn && !WORD_BRANDS.has(brand) && path.includes(brand)) return brand
  }
  return null
}

function hasMixedScripts(unicode: string): boolean {
  const latin = /[a-z]/i.test(unicode)
  const cyrillic = /[Ѐ-ӿ]/.test(unicode)
  const greek = /[Ͱ-Ͽ]/.test(unicode)
  return [latin, cyrillic, greek].filter(Boolean).length > 1
}

// ---- Tier 1 rules ----

const EXECUTABLE_EXT = new Set<string>([
  ...ALWAYS_SCAN_EXTENSIONS.executables,
  ...ALWAYS_SCAN_EXTENSIONS.scripts
])

const HOST_IN_TEXT =
  /(?:^|[\s(<"'])((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,63})(?:[/:\s)>"'?#]|$)/i

/** The registered domain a link's visible text claims, e.g. "accounts.google.com" → google.com. */
/** Extensions that are also top-level domains: `update.sh` and `notes.md` are file names. */
const FILE_LIKE_TLDS = new Set(['sh', 'zip', 'mov', 'py', 'md', 'pl', 'rs', 'ps', 'cs', 'so', 'gz'])

export function domainInText(text: string): string | null {
  const m = HOST_IN_TEXT.exec(text.trim().toLowerCase())
  if (!m) return null
  const written = m[1]
  const host = written.replace(/^https?:\/\//, '')
  const p = parseDomain(host, TLDTS)
  if (!p.isIcann || !p.domain) return null
  const urlLike = /^https?:\/\//.test(written) || host.startsWith('www.')
  if (!urlLike && !p.subdomain && FILE_LIKE_TLDS.has(p.publicSuffix ?? '')) return null
  return p.domain
}

function isPrivateIp(host: string): boolean {
  return (
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  )
}

const reason = (code: string, text: string, weight: number, hard = false): Reason => ({
  code,
  text,
  weight,
  hard
})

export interface Tier1Result {
  reasons: Reason[]
  /** A shortener: the destination can't be seen without following the link. */
  hiddenDestination: boolean
  /** A popular domain (Tranco stand-in): the young-domain and lookalike rules can't fire. */
  known: boolean
}

/**
 * Tier 1: the URL on its own, in microseconds. `linkText` is the visible text of the `<a>`.
 * Trusted sites skip these heuristics (the caller decides); Safe Browsing and feeds still run.
 */
export function tier1(link: ParsedLink, linkText = ''): Tier1Result {
  const reasons: Reason[] = []
  const known = KNOWN_DOMAINS.has(link.domain)
  const hiddenDestination = SHORTENERS.has(link.domain) || SHORTENERS.has(link.host)
  if (hiddenDestination) {
    reasons.push(reason('hidden_destination', 'short link: Aegis can’t see where it goes', 0))
  }

  const claimed = domainInText(linkText)
  if (
    claimed &&
    claimed !== link.domain &&
    !sameOwner(claimed, link.domain) &&
    !known &&
    !hiddenDestination
  ) {
    const big = KNOWN_DOMAINS.has(claimed) || Object.keys(BRANDS).some((b) => ownsBrand(b, claimed))
    reasons.push(
      reason('text_mismatch', `link says ${claimed} but goes to ${link.domain}`, big ? 40 : 25)
    )
  }

  if (link.isIp) {
    if (!isPrivateIp(link.host)) reasons.push(reason('raw_ip', 'goes to a bare IP address', 25))
  } else {
    const unicode = domainToUnicode(link.host)
    if (link.host.split('.').some((l) => l.startsWith('xn--'))) {
      reasons.push(
        hasMixedScripts(unicode)
          ? reason('mixed_scripts', `mixes alphabets in its name (${unicode})`, 40)
          : reason('punycode', `uses an international name (${unicode})`, 10)
      )
    }
    const brand = known ? null : lookalikeBrand(link.label, link.domain)
    if (brand) {
      reasons.push(reason('lookalike_brand', `looks like “${brand}” but isn’t`, 40))
    } else {
      const named = brandElsewhere(link)
      if (named) {
        reasons.push(reason('brand_elsewhere', `names “${named}” on an unrelated site`, 25))
      }
    }
    if (RISKY_TLDS.has(link.suffix.split('.').pop() ?? '')) {
      reasons.push(reason('risky_tld', `.${link.suffix} is often used for scams`, 15))
    }
    const extra = link.subdomain ? link.subdomain.split('.').length : 0
    if (extra >= 4) reasons.push(reason('many_subdomains', `${extra} levels of subdomains`, 10))
  }

  if (link.url.username || link.url.password || /@/.test(link.url.href.split('/')[2] ?? '')) {
    reasons.push(reason('at_sign', 'hides its real address after an “@”', 30))
  }
  if (link.url.port && !['80', '443'].includes(link.url.port)) {
    reasons.push(reason('odd_port', `uses port ${link.url.port}`, 10))
  }
  if (link.url.href.length > 200) reasons.push(reason('long_url', 'very long address', 5))
  const ext = link.url.pathname.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1]
  if (ext && EXECUTABLE_EXT.has(ext)) {
    reasons.push(reason('executable', `downloads a .${ext} file`, 15))
  }
  return { reasons, hiddenDestination, known }
}

/** `data:` and `javascript:` links (MEGA_PROMPT §5.2). Trivial `javascript:void(0)` is ignored. */
export function schemeReasons(href: string): Reason[] | null {
  const h = href.trim().toLowerCase()
  if (h.startsWith('data:')) {
    return /^data:(text\/html|application\/xhtml|image\/svg)/.test(h)
      ? [reason('data_url', 'opens a page hidden inside the link', 50)]
      : [reason('data_url', 'link carries its own content', 15)]
  }
  if (h.startsWith('javascript:')) {
    const body = h.slice('javascript:'.length).replace(/\s/g, '')
    if (body === '' || /^(void\(0\)|void0|;|return(false)?;?|false;?)$/.test(body)) return []
    return [reason('javascript_url', 'runs code instead of opening a page', 20)]
  }
  return null
}

// ---- Facts from lookups, and the verdict ----

/** Results from linkData.ts for one link; anything missing simply didn't run or finish. */
export interface LinkFacts {
  safeBrowsing?: { match: boolean; threat?: string }
  /** The feed that lists this exact URL, if any. */
  feedMatch?: string | null
  /** A feed listing other URLs on the same host. */
  feedHost?: string | null
  /** Days since the domain was registered (RDAP). */
  domainAgeDays?: number | null
  dns?: { exists: boolean; fastFlux: boolean; local?: 'loopback' | 'private' | null }
  /** Days since the first certificate for the domain was logged. */
  certAgeDays?: number | null
}

export type LinkCheckKey = 'tier1' | 'safeBrowsing' | 'threatFeeds' | 'rdap' | 'dns' | 'certLogs'

export function factReasons(facts: LinkFacts, known: boolean): Reason[] {
  const out: Reason[] = []
  if (facts.safeBrowsing?.match) {
    const what = facts.safeBrowsing.threat === 'MALWARE' ? 'malware' : 'phishing'
    out.push(reason('safe_browsing', `Google Safe Browsing lists it as ${what}`, 100, true))
  }
  if (facts.feedMatch) {
    out.push(reason('threat_feed', `listed by ${facts.feedMatch}`, 100, true))
  } else if (facts.feedHost) {
    out.push(reason('threat_feed_host', `its site is listed by ${facts.feedHost}`, 40))
  }
  if (!known && facts.domainAgeDays != null && facts.domainAgeDays < 30) {
    const d = Math.max(0, Math.round(facts.domainAgeDays))
    const text = d === 0 ? 'registered today' : `registered ${d} day${d === 1 ? '' : 's'} ago`
    out.push(reason('domain_age', text, d < 7 ? 25 : 15))
  }
  if (facts.dns && !facts.dns.exists) {
    out.push(reason('dns_missing', 'the domain doesn’t resolve', 10))
  }
  if (facts.dns?.local === 'loopback') {
    out.push(reason('dns_local', 'points to this computer, not a public website', 20))
  } else if (facts.dns?.local === 'private') {
    out.push(reason('dns_local', 'points to a private network, not a public website', 20))
  }
  if (facts.dns?.fastFlux) {
    out.push(reason('fast_flux', 'its addresses change like a fast-flux network', 20))
  }
  // Certificate age only stands in for a missing registration date: a new domain always has a
  // new certificate, so counting both would score one fact twice.
  if (!known && facts.domainAgeDays == null && facts.certAgeDays != null && facts.certAgeDays < 7) {
    const d = Math.max(0, Math.round(facts.certAgeDays))
    out.push(
      reason(
        'cert_new',
        d === 0
          ? 'first certificate issued today'
          : `first certificate issued ${d} day${d === 1 ? '' : 's'} ago`,
        10
      )
    )
  }
  return out
}

export interface ScoreInput {
  href: string
  linkText?: string
  trusted: boolean
  facts: LinkFacts
  checks: Partial<Record<LinkCheckKey, CheckState>>
}

/**
 * The verdict for one link (destination already unwrapped by the caller when needed). A short
 * link with nothing else against it, a brand-new domain alone, or a domain that points to this
 * computer is Unknown (decisions 1, 26).
 */
export function scoreLink({
  href,
  linkText = '',
  trusted,
  facts,
  checks
}: ScoreInput): LinkVerdict {
  const scheme = schemeReasons(href)
  const link = parseLink(href)
  if (scheme || !link) {
    const reasons = scheme ?? []
    const v = combine(reasons)
    return {
      url: href,
      urlStripped: stripSecrets(href),
      domain: '',
      verdict: v.verdict,
      score: v.score,
      reasons: v.reasons,
      trusted: false,
      checks: { tier1: 'ok' }
    }
  }
  const t1 = tier1(link, linkText)
  const reasons = [...(trusted ? [] : t1.reasons), ...factReasons(facts, t1.known || trusted)]
  // Signals that say "this isn't a normal site" without saying it's hostile: alone, they make the
  // link Unknown (held at the click), not Suspicious.
  const UNSURE = ['domain_age', 'cert_new', 'dns_local']
  const unsureOnly = reasons.length > 0 && reasons.every((r) => UNSURE.includes(r.code))
  const hidden = t1.hiddenDestination && !trusted
  const v = combine(reasons, { confident: !(hidden || unsureOnly) })
  return {
    url: href,
    urlStripped: stripSecrets(href),
    domain: link.domain,
    verdict: v.verdict,
    score: v.score,
    // Strongest first: the guard and the Links table lead with reasons[0].
    reasons: [...v.reasons].sort((a, b) => Number(b.hard) - Number(a.hard) || b.weight - a.weight),
    trusted,
    checks: { ...checks, tier1: 'ok' }
  }
}
