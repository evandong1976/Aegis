import { describe, expect, it } from 'vitest'
import { linkHeadline } from '@shared/verdicts'
import {
  domainInText,
  editDistance,
  lookalikeBrand,
  parseLink,
  registeredDomain,
  schemeReasons,
  scoreLink,
  skeleton,
  stripSecrets,
  tier1,
  unwrapRedirects,
  type LinkFacts
} from './links'
import type { LinkVerdict } from '@shared/types'

const score = (href: string, linkText = '', facts: LinkFacts = {}, trusted = false): LinkVerdict =>
  scoreLink({ href, linkText, trusted, facts, checks: {} })
const codes = (href: string, linkText = ''): string[] =>
  tier1(parseLink(href)!, linkText).reasons.map((r) => r.code)

describe('parsing', () => {
  it('finds the registered domain, private suffixes included', () => {
    expect(registeredDomain('https://login.paypal.co.uk.evil-site.sbs/a')).toBe('evil-site.sbs')
    expect(registeredDomain('https://www.amazon.co.uk/')).toBe('amazon.co.uk')
    expect(registeredDomain('https://alice.github.io/x')).toBe('alice.github.io')
    expect(registeredDomain('mail.google.com')).toBe('google.com')
  })

  it('only parses http and https', () => {
    expect(parseLink('mailto:a@b.com')).toBeNull()
    expect(parseLink('not a url')).toBeNull()
    expect(parseLink('https://192.168.1.1:8080/')?.isIp).toBe(true)
  })
})

describe('stripSecrets (MEGA_PROMPT §6 rule 11)', () => {
  it('removes token, session, email and code parameters, the fragment and userinfo', () => {
    const out = stripSecrets(
      'https://user:pw@example.com/reset?token=abc&session=1&email=a%40b.com&code=99&page=2#access_token=x'
    )
    expect(out).toBe('https://example.com/reset?page=2')
  })

  it('removes long random values whatever the parameter is called', () => {
    expect(stripSecrets('https://x.com/a?ref=docs&r=Zx81kQa0pL3mN7vB2cY9tR4w')).toBe(
      'https://x.com/a?ref=docs'
    )
    expect(
      stripSecrets('https://x.com/a?u=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4')
    ).toBe('https://x.com/a')
  })

  it('keeps ordinary parameters and the path', () => {
    expect(stripSecrets('https://shop.example.com/item/42?color=red&size=m')).toBe(
      'https://shop.example.com/item/42?color=red&size=m'
    )
  })

  it('never returns the body of a data: or javascript: link', () => {
    expect(stripSecrets('data:text/html,<script>steal()</script>')).toBe('data:…')
  })
})

describe('redirect wrappers', () => {
  it('reads the destination from the wrapper without following it', () => {
    expect(unwrapRedirects('https://www.google.com/url?q=https://evil.example/login&sa=D')).toEqual(
      ['https://evil.example/login']
    )
    expect(
      unwrapRedirects(
        'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fpaypa1-secure.top%2Fx&data=05'
      )
    ).toEqual(['https://paypa1-secure.top/x'])
  })

  it('ignores parameters that are not URLs', () => {
    expect(unwrapRedirects('https://www.google.com/search?q=hello+world')).toEqual([])
  })
})

describe('lookalikes', () => {
  it('measures edit distance with transpositions', () => {
    expect(editDistance('paypal', 'paypla')).toBe(1)
    expect(editDistance('northwlnd', 'northwind')).toBe(1)
    expect(editDistance('abc', 'xyzxyz', 2)).toBe(3)
  })

  it('maps digits and Cyrillic letters to what they imitate', () => {
    expect(skeleton('paypa1')).toBe('paypal')
    expect(skeleton('аррlе')).toBe('apple')
    expect(skeleton('rnicrosoft')).toBe('microsoft')
  })

  it('catches digit swaps, typos and brand + lure word', () => {
    expect(lookalikeBrand('paypa1', 'paypa1.com')).toBe('paypal')
    expect(lookalikeBrand('login-northwlnd-io', 'login-northwlnd-io.sbs')).toBe('northwind')
    expect(lookalikeBrand('paypal-secure-login', 'paypal-secure-login.com')).toBe('paypal')
    expect(lookalikeBrand('amazonsupport', 'amazonsupport.net')).toBe('amazon')
    expect(lookalikeBrand('micros0ft', 'micros0ft.com')).toBe('microsoft')
  })

  it('never fires for the brand itself or for ordinary words', () => {
    expect(lookalikeBrand('paypal', 'paypal.com')).toBeNull()
    expect(lookalikeBrand('discovery', 'discovery.com')).toBeNull()
    expect(lookalikeBrand('targets', 'targets.org')).toBeNull()
    expect(lookalikeBrand('pineapple', 'pineapple.com')).toBeNull()
    expect(lookalikeBrand('nytimes', 'nytimes.com')).toBeNull()
  })
})

describe('Tier 1 rules', () => {
  it('flags link text that names a different domain', () => {
    expect(codes('https://login-northwlnd-io.sbs/sso', 'accounts.google.com')).toContain(
      'text_mismatch'
    )
    expect(domainInText('Sign in at accounts.google.com today')).toBe('google.com')
    expect(domainInText('Click here')).toBeNull()
    expect(domainInText('update.sh')).toBeNull()
    expect(domainInText('notes.md')).toBeNull()
    expect(domainInText('https://update.sh')).toBe('update.sh')
  })

  it('accepts text and link owned by the same brand', () => {
    expect(codes('https://www.paypalobjects.com/x', 'paypal.com')).not.toContain('text_mismatch')
  })

  it('flags raw IPs, @ tricks, odd ports, risky TLDs and many subdomains', () => {
    expect(codes('http://203.0.113.9/login')).toContain('raw_ip')
    expect(codes('http://192.168.1.1/')).not.toContain('raw_ip')
    expect(codes('https://paypal.com@evil.example/')).toContain('at_sign')
    expect(codes('https://example.com:8443/')).toContain('odd_port')
    expect(codes('https://free-prizes.xyz/')).toContain('risky_tld')
    expect(codes('https://a.b.c.d.example.com/')).toContain('many_subdomains')
  })

  it('flags brands in subdomains, and in paths only next to sign-in words', () => {
    expect(codes('https://paypal.account-check.net/')).toContain('brand_elsewhere')
    expect(codes('https://cheap-hosting.net/paypal/login')).toContain('brand_elsewhere')
    expect(codes('https://someblog.net/how-to-use-paypal')).not.toContain('brand_elsewhere')
  })

  it('flags punycode and, more heavily, mixed alphabets', () => {
    expect(codes('https://xn--pypal-4ve.com/')).toContain('mixed_scripts')
    expect(codes('https://xn--fiqs8s.com/')).toContain('punycode')
  })

  it('flags executables in the path and shorteners', () => {
    expect(codes('https://downloads.example.com/setup.dmg')).toContain('executable')
    expect(codes('https://bit.ly/3xQ9f2k')).toContain('hidden_destination')
  })

  it('treats data: pages as risky and javascript:void(0) as nothing', () => {
    expect(schemeReasons('data:text/html;base64,PHNjcmlwdD4=')?.[0].weight).toBe(50)
    expect(schemeReasons('javascript:void(0)')).toEqual([])
    expect(schemeReasons('javascript:fetch("//x")')?.[0].code).toBe('javascript_url')
    expect(schemeReasons('https://example.com')).toBeNull()
  })
})

describe('scoreLink verdicts', () => {
  it('is clean for an ordinary link', () => {
    const v = score('https://github.com/northwind/aegis')
    expect(v.verdict).toBe('clean')
    expect(v.reasons).toEqual([])
  })

  it('is malicious for the demo phishing link', () => {
    const v = score('https://login-northwlnd-io.sbs/sso?session=8f2c', 'accounts.google.com', {
      domainAgeDays: 2,
      certAgeDays: 1
    })
    expect(v.verdict).toBe('malicious')
    expect(v.urlStripped).toBe('https://login-northwlnd-io.sbs/sso')
    expect(v.reasons[0].weight).toBeGreaterThanOrEqual(v.reasons[1].weight)
    expect(linkHeadline(v)).toBe('This link doesn’t go where it says it does.')
  })

  it('makes a Safe Browsing or feed match malicious outright, even for trusted sites', () => {
    expect(score('https://example.org/', '', { safeBrowsing: { match: true } }).verdict).toBe(
      'malicious'
    )
    const trusted = score('https://example.org/', '', { feedMatch: 'URLhaus' }, true)
    expect(trusted.verdict).toBe('malicious')
    expect(trusted.trusted).toBe(true)
  })

  it('holds short links as Unknown (decision 26)', () => {
    const v = score('https://bit.ly/3xQ9f2k')
    expect(v.verdict).toBe('unknown')
    expect(linkHeadline(v)).toBe('Aegis can’t see where this link goes.')
  })

  it('makes a brand-new domain with no other signal Unknown, not Suspicious (decision 1)', () => {
    expect(score('https://fresh-bakery.com/', '', { domainAgeDays: 3 }).verdict).toBe('unknown')
    expect(score('https://fresh-bakery.com/', '', { domainAgeDays: 400 }).verdict).toBe('clean')
  })

  it('never applies the young-domain rule to known domains', () => {
    expect(score('https://github.com/', '', { domainAgeDays: 1 }).verdict).toBe('clean')
  })

  it('lets trusted sites skip the heuristics', () => {
    const v = score('https://paypa1.com/', '', {}, true)
    expect(v.verdict).toBe('clean')
    expect(v.trusted).toBe(true)
  })

  it('reports which checks ran', () => {
    const v = scoreLink({
      href: 'https://example.org/',
      trusted: false,
      facts: {},
      checks: { safeBrowsing: 'skipped', rdap: 'timeout' }
    })
    expect(v.checks).toEqual({ safeBrowsing: 'skipped', rdap: 'timeout', tier1: 'ok' })
  })
})

describe('certificate logs stand in for a missing registration date', () => {
  it('counts a fresh certificate only when RDAP had no date', () => {
    expect(
      score('https://shop.example.de/', '', { domainAgeDays: null, certAgeDays: 1 }).reasons.map(
        (r) => r.code
      )
    ).toEqual(['cert_new'])
    expect(
      score('https://shop.example.de/', '', { domainAgeDays: 2, certAgeDays: 1 }).reasons.map(
        (r) => r.code
      )
    ).toEqual(['domain_age'])
    expect(
      score('https://shop.example.de/', '', { domainAgeDays: null, certAgeDays: 1 }).verdict
    ).toBe('unknown')
  })
})

describe('a public link that points to this computer', () => {
  it('is Unknown on its own and adds weight to other signals', () => {
    const local = { dns: { exists: true, fastFlux: false, local: 'loopback' as const } }
    const alone = score('http://jiameng.com', 'jiameng.com', local)
    expect(alone.verdict).toBe('unknown')
    expect(alone.reasons[0].text).toBe('points to this computer, not a public website')
    expect(score('http://paypa1-login.com/', '', local).verdict).toBe('suspicious')
  })
})

describe('sign-in and payment pages over plain http', () => {
  it('flags them as Suspicious', () => {
    const login = score('http://shop-example.com/account/login')
    expect(login.verdict).toBe('suspicious')
    expect(login.reasons[0].text).toBe('a sign-in page without encryption (http)')
    expect(linkHeadline(login)).toBe('This page would send what you type without encryption.')
    expect(score('http://store-example.com/checkout?step=2').reasons[0].text).toBe(
      'a payment page without encryption (http)'
    )
    expect(codes('http://login.some-portal.net/')).toContain('http_sensitive')
  })

  it('leaves other http pages, https pages, known sites and local addresses alone', () => {
    expect(score('http://jiameng.com/').verdict).toBe('clean')
    expect(codes('https://shop-example.com/account/login')).not.toContain('http_sensitive')
    expect(codes('http://github.com/login')).not.toContain('http_sensitive')
    expect(codes('http://192.168.1.1/login')).not.toContain('http_sensitive')
    expect(codes('http://localhost:3000/login')).not.toContain('http_sensitive')
    expect(codes('http://blog-example.com/authors/jane')).not.toContain('http_sensitive')
  })
})
