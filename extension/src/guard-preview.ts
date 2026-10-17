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
      { code: 'domain_age', text: 'registered 2 days ago', weight: 35, hard: false },
      { code: 'password_form', text: 'asks for a password', weight: 30, hard: false },
      { code: 'lookalike_brand', text: 'looks like “northwind”', weight: 20, hard: false },
      { code: 'safe_browsing', text: 'no Safe Browsing match', weight: 0, hard: false }
    ]
  },
  linkText: 'accounts.google.com',
  headline: 'This link is not the sign-in page it claims to be.',
  checkedMs: 1200
}

function open(): void {
  showClickGuard(
    sample,
    {
      back: () => console.log('[guard] back'),
      inspect: () => console.log('[guard] inspect'),
      proceed: () => console.log('[guard] continue'),
      trust: () => console.log('[guard] trust')
    },
    './'
  )
}

document.getElementById('bad')?.addEventListener('click', (e) => {
  e.preventDefault()
  open()
})
open()
