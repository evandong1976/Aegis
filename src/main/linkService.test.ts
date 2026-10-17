import { describe, expect, it } from 'vitest'
import type { PageRequest } from '@shared/bridge'
import type { PageSnapshot, ScanReport } from '@shared/types'
import { checkRuns, LinkService, seenIn, type Lookups } from './linkService'
import {
  looksFastFlux,
  normalizeFeedUrl,
  oldestCertAgeDays,
  parseFeed,
  registrationDate,
  ThreatFeeds
} from './linkData'

const never = <T>(): Promise<T> => new Promise<T>(() => {})

function service(
  over: Partial<Lookups> = {},
  opts: { paused?: boolean; trusted?: string[] } = {}
): {
  svc: LinkService
  scans: ScanReport[]
  pages: Array<PageSnapshot | null>
  blocked: string[]
  calls: Record<'rdap' | 'dns' | 'ct' | 'sb', string[]>
} {
  const scans: ScanReport[] = []
  const pages: Array<PageSnapshot | null> = []
  const blocked: string[] = []
  const calls = {
    rdap: [] as string[],
    dns: [] as string[],
    ct: [] as string[],
    sb: [] as string[]
  }
  const lookups: Lookups = {
    safeBrowsing: (urls) => {
      calls.sb.push(...urls)
      return new Map(urls.map((u) => [u, Promise.resolve({ match: u.includes('sb-listed') })]))
    },
    feeds: (href) => ({ url: href.includes('feed-listed') ? 'URLhaus' : null, host: null }),
    domainAgeDays: async (d) => {
      calls.rdap.push(d)
      return d === 'brand-new.com' ? 2 : 4000
    },
    dnsFacts: async (h) => {
      calls.dns.push(h)
      return { exists: true, fastFlux: false }
    },
    certAgeDays: async (d) => {
      calls.ct.push(d)
      return 1
    },
    ...over
  }
  const svc = new LinkService({
    isPaused: () => opts.paused ?? false,
    trustedDomains: () => new Set(opts.trusted ?? []),
    putScan: (r) => {
      const i = scans.findIndex((s) => s.id === r.id)
      if (i >= 0) scans[i] = r
      else scans.push(r)
    },
    log: () => {},
    onPage: (p) => pages.push(p),
    onBlocked: (v) => blocked.push(v.domain),
    lookups
  })
  return { svc, scans, pages, blocked, calls }
}

const page = (links: Array<[string, string?]>, extra: Partial<PageRequest> = {}): PageRequest => ({
  tabId: 7,
  pageUrl: 'https://mail.google.com/mail/u/0/#inbox/abc',
  links: links.map(([href, text = '']) => ({ href, text })),
  ...extra
})

describe('LinkService.check', () => {
  it('scores every link and fills the page counts', async () => {
    const { svc, pages } = service()
    const res = await svc.check(
      page([
        ['https://github.com/x'],
        ['https://sb-listed.example/'],
        ['https://bit.ly/abc'],
        ['https://brand-new.com/']
      ])
    )
    const by = Object.fromEntries(res.links.map((l) => [l.url, l.verdict]))
    expect(by).toEqual({
      'https://github.com/x': 'clean',
      'https://sb-listed.example/': 'malicious',
      'https://bit.ly/abc': 'unknown',
      'https://brand-new.com/': 'unknown'
    })
    expect(res.paused).toBe(false)
    expect(pages.at(-1)?.counts).toEqual({ clean: 1, unknown: 2, suspicious: 0, malicious: 1 })
    expect(pages.at(-1)?.top?.domain).toBe('sb-listed.example')
  })

  it('only sends stripped URLs to Safe Browsing and only domains to RDAP and DNS', async () => {
    const { svc, calls } = service()
    await svc.check(page([['https://shop.example.org/cart?session=abc123&item=4#pay']]))
    expect(calls.sb).toEqual(['https://shop.example.org/cart?item=4'])
    expect(calls.rdap).toEqual(['example.org'])
    expect(calls.dns).toEqual(['shop.example.org'])
  })

  it('skips domain lookups for known, trusted, shortener and same-site links', async () => {
    const { svc, calls } = service({}, { trusted: ['mycompany.com'] })
    await svc.check(
      page([
        ['https://github.com/'],
        ['https://intranet.mycompany.com/'],
        ['https://bit.ly/x'],
        ['https://mail.google.com/x']
      ])
    )
    expect(calls.rdap).toEqual([])
    expect(calls.dns).toEqual([])
  })

  it('checks certificate logs only for young or undated domains', async () => {
    const { svc, calls } = service()
    await svc.check(page([['https://brand-new.com/'], ['https://old-shop.com/']]))
    expect(calls.ct).toEqual(['brand-new.com'])
  })

  it('answers within the budget and marks slow lookups as timed out', async () => {
    const { svc } = service({ domainAgeDays: () => never(), certAgeDays: () => never() })
    const started = Date.now()
    const res = await svc.check(page([['https://slow-registry.com/']]))
    expect(Date.now() - started).toBeLessThan(2500)
    expect(res.links[0].checks.rdap).toBe('timeout')
    expect(res.links[0].verdict).toBe('clean')
  }, 5000)

  it('ignores a feed listing elsewhere on a known site, but not on an unknown one', async () => {
    const { svc } = service({ feeds: () => ({ url: null, host: 'URLhaus' }) })
    const res = await svc.check(page([['https://github.com/x'], ['https://files.some-host.net/a']]))
    const by = Object.fromEntries(res.links.map((l) => [l.url, l.verdict]))
    expect(by['https://github.com/x']).toBe('clean')
    expect(by['https://files.some-host.net/a']).toBe('suspicious')
  })

  it('records failed lookups as errors without failing the page', async () => {
    const { svc } = service({ dnsFacts: () => Promise.reject(new Error('SERVFAIL')) })
    const res = await svc.check(page([['https://some-shop.com/']]))
    expect(res.links[0].checks.dns).toBe('error')
  })

  it('checks the destination of a redirect wrapper and keeps the worse verdict', async () => {
    const { svc } = service()
    const href = 'https://www.google.com/url?q=https://sb-listed.example/login'
    const res = await svc.check(page([[href]]))
    expect(res.links[0].url).toBe(href)
    expect(res.links[0].verdict).toBe('malicious')
    expect(res.links[0].domain).toBe('sb-listed.example')
    expect(res.links[0].reasons.map((r) => r.code)).toContain('redirect')
  })

  it('returns nothing to act on while protection is paused', async () => {
    const { svc } = service({}, { paused: true })
    const res = await svc.check(page([['https://sb-listed.example/']]))
    expect(res).toEqual({ paused: true, links: [], scamText: null, sender: null })
  })

  it('starts the counts again when the tab moves to another page', async () => {
    const { svc, pages } = service()
    await svc.check(page([['https://sb-listed.example/']]))
    await svc.check(
      page([['https://github.com/']], { pageUrl: 'https://mail.google.com/mail/u/0/#inbox/def' })
    )
    expect(pages.at(-1)?.counts.malicious).toBe(0)
  })
})

describe('LinkService.click', () => {
  it('records a held click, then updates the same entry when the user decides', async () => {
    const { svc, scans, blocked } = service()
    await svc.check(page([['https://sb-listed.example/x?token=secret', 'accounts.google.com']]))
    const click = {
      clickId: '0b6f8a52-5d8e-4b1f-9d2b-2f7c3f1f0a11',
      tabId: 7,
      pageUrl: 'https://mail.google.com/mail/u/0/#inbox/abc',
      href: 'https://sb-listed.example/x?token=secret',
      linkText: 'accounts.google.com',
      verdictMs: 12
    }
    await svc.click({ ...click, decision: 'held' })
    expect(scans).toHaveLength(1)
    expect(scans[0]).toMatchObject({
      kind: 'link',
      seenIn: 'Gmail',
      url: 'https://sb-listed.example/x',
      verdict: 'malicious',
      action: 'held',
      durationMs: 12
    })
    expect(blocked).toEqual(['sb-listed.example'])
    await svc.click({ ...click, decision: 'blocked' })
    expect(scans).toHaveLength(1)
    expect(scans[0].action).toBe('blocked')
    expect(scans[0].createdAt).toBeTruthy()
    expect(blocked).toHaveLength(1)
  })

  it('keeps the verdict the user saw when they then trust the site', async () => {
    const trusted: string[] = []
    const { svc, scans } = service({}, { trusted })
    await svc.check(page([['https://example.com/', 'paypal.com']]))
    const click = {
      clickId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
      tabId: 7,
      pageUrl: 'https://mail.google.com/mail/u/0/#inbox/abc',
      href: 'https://example.com/',
      linkText: 'paypal.com',
      verdictMs: 40
    }
    await svc.click({ ...click, decision: 'held' })
    trusted.push('example.com')
    svc.forgetDomain('example.com')
    await svc.click({ ...click, decision: 'allowed', trusted: true })
    expect(scans).toHaveLength(1)
    expect(scans[0]).toMatchObject({ verdict: 'suspicious', action: 'allowed' })
  })

  it('scores a link it has not seen before recording it', async () => {
    const { svc, scans } = service()
    await svc.click({
      clickId: '5c1d6a2b-0f3e-4a9b-8c7d-6e5f4a3b2c1d',
      pageUrl: 'https://news.example.com/',
      href: 'https://github.com/',
      linkText: 'GitHub',
      decision: 'allowed',
      verdictMs: 3
    })
    expect(scans[0]).toMatchObject({
      verdict: 'clean',
      action: 'allowed',
      reason: 'No threats found',
      seenIn: 'Chrome'
    })
  })
})

describe('report details', () => {
  it('lists the checks that ran in plain words', () => {
    const runs = checkRuns(
      {
        verdict: {
          url: 'u',
          urlStripped: 'u',
          domain: 'd.com',
          verdict: 'unknown',
          score: 25,
          reasons: [{ code: 'domain_age', text: 'registered 2 days ago', weight: 25, hard: false }],
          trusted: false,
          checks: {
            tier1: 'ok',
            safeBrowsing: 'skipped',
            threatFeeds: 'ok',
            rdap: 'ok',
            dns: 'timeout',
            certLogs: 'ok'
          }
        },
        facts: { domainAgeDays: 2, certAgeDays: 1, feedMatch: null }
      },
      false
    )
    expect(runs).toEqual([
      { name: 'Link rules', state: 'ok', result: 'passed' },
      { name: 'Google Safe Browsing', state: 'skipped', result: 'no key' },
      { name: 'Threat feeds (URLhaus, OpenPhish)', state: 'ok', result: 'no match' },
      { name: 'Domain age (RDAP)', state: 'warn', result: 'registered 2 days ago' },
      { name: 'DNS records', state: 'warn', result: 'timed out' },
      { name: 'Certificate logs', state: 'warn', result: 'oldest valid 1 day ago' }
    ])
  })

  it('names Gmail and Outlook pages', () => {
    expect(seenIn('https://mail.google.com/mail/u/0/')).toBe('Gmail')
    expect(seenIn('https://outlook.office.com/mail/')).toBe('Outlook')
    expect(seenIn('https://example.com/')).toBe('Chrome')
  })
})

describe('lookup parsers', () => {
  it('reads URLhaus CSV and OpenPhish lines', () => {
    const csv =
      '# comment\n"1","2026-10-17","http://bad.example/a.exe","online","","malware","","",""\n'
    expect(parseFeed(csv)).toEqual(['http://bad.example/a.exe'])
    expect(parseFeed('https://phish.example/login\n\n')).toEqual(['https://phish.example/login'])
  })

  it('matches feed URLs exactly and by host', () => {
    const feeds = new ThreatFeeds()
    feeds.add('URLhaus', ['http://Bad.Example/a.exe'])
    const next = new ThreatFeeds()
    next.add('URLhaus', ['http://bad.example/a.exe'])
    feeds.replace(next)
    expect(feeds.match('http://bad.example/a.exe')).toEqual({ url: 'URLhaus', host: 'URLhaus' })
    expect(feeds.match('http://bad.example/')).toEqual({ url: null, host: 'URLhaus' })
    expect(feeds.match('https://good.example/')).toEqual({ url: null, host: null })
    expect(normalizeFeedUrl('HTTP://A.com/x/#f')).toBe('http://a.com/x')
  })

  it('reads the registration date from RDAP', () => {
    const d = registrationDate({
      events: [{ eventAction: 'registration', eventDate: '2007-10-09T18:20:50Z' }]
    })
    expect(d?.toISOString()).toBe('2007-10-09T18:20:50.000Z')
    expect(registrationDate({})).toBeNull()
  })

  it('spots fast flux but not ordinary CDNs', () => {
    const flux = ['1.1.0.1', '2.2.0.1', '3.3.0.1', '4.4.0.1', '5.5.0.1'].map((address) => ({
      address,
      ttl: 60
    }))
    expect(looksFastFlux(flux)).toBe(true)
    expect(
      looksFastFlux([
        { address: '104.16.1.1', ttl: 300 },
        { address: '104.16.2.2', ttl: 300 }
      ])
    ).toBe(false)
  })

  it('finds the oldest valid certificate', () => {
    const now = Date.parse('2026-10-17T00:00:00Z')
    expect(
      oldestCertAgeDays(
        [{ not_before: '2026-10-15T00:00:00Z' }, { not_before: '2026-10-16T00:00:00Z' }],
        now
      )
    ).toBe(2)
    expect(oldestCertAgeDays([], now)).toBeNull()
  })
})
