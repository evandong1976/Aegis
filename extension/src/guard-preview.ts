// Dev page for the click guard: open extension/dist/guard-preview.html (served or as an extension
// page) to check the overlay against the Figma frame. Uses fixed sample data, not a live verdict.

import { showClickGuard } from './guard'

const sample = {
  verdict: {
    url: 'https://login-northwlnd-io.sbs/sso?session=8f2c1a9e77',
    urlStripped: 'https://login-northwlnd-io.sbs/sso',
    domain: 'login-northwlnd-io.sbs',
    verdict: 'malicious' as const,
    score: 94,
    trusted: false,
    checks: { tier1: 'ok' as const, safeBrowsing: 'ok' as const },
    reasons: [
      {
        code: 'text_mismatch',
        text: 'link says google.com but goes to login-northwlnd-io.sbs',
        weight: 40,
        hard: false
      },
      {
        code: 'lookalike_brand',
        text: 'looks like “northwind” but isn’t',
        weight: 40,
        hard: false
      },
      { code: 'domain_age', text: 'registered 2 days ago', weight: 25, hard: false },
      { code: 'risky_tld', text: '.sbs is often used for scams', weight: 15, hard: false }
    ]
  },
  linkText: 'accounts.google.com',
  headline: 'This link doesn’t go where it says it does.',
  checkedMs: 1200,
  canTrust: true
}

function open(): void {
  showClickGuard(
    sample,
    {
      back: () => console.log('[guard] back'),
      proceed: () => console.log('[guard] continue'),
      trust: () => console.log('[guard] trust')
    },
    (path) => `./${path}`
  )
}

document.getElementById('bad')?.addEventListener('click', (e) => {
  e.preventDefault()
  open()
})
open()
