// The click guard (Figma frame "Click guard — blocked link", MEGA_PROMPT §5.1): an overlay in a
// closed Shadow DOM, so the page can neither style nor script it. It shows what the link said
// against where it actually goes, the reasons, and Back to safety / Inspect in sandbox /
// Continue anyway / Trust this site. The content script wires it to real verdicts in milestone 2.

import type { LinkVerdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'
import { badge, button, el } from './dom'

export interface GuardChoice {
  back(): void
  inspect(): void
  proceed(): void
  trust(): void
}

export interface GuardInput {
  verdict: LinkVerdict
  /** What the link text claimed, e.g. "accounts.google.com". */
  linkText: string
  /** The plain-English headline, e.g. "This link is not the sign-in page it claims to be." */
  headline: string
  checkedMs: number
}

const HOST_ID = 'aegis-click-guard'

let fontsLoaded = false
/** @font-face doesn't apply inside a shadow root, so the three families are added to the page. */
function loadFonts(base: string): void {
  if (fontsLoaded) return
  fontsLoaded = true
  const faces: Array<[string, string, string]> = [
    ['Sora', 'Sora-Variable.woff2', '100 800'],
    ['Manrope', 'Manrope-Variable.woff2', '200 800'],
    ['JetBrains Mono', 'JetBrainsMono-Variable.woff2', '100 800']
  ]
  for (const [family, file, weight] of faces) {
    const face = new FontFace(family, `url(${base}ds/fonts/${file})`, { weight })
    void face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {})
  }
}

function chipTone(weight: number, hard: boolean): string {
  if (hard || weight >= 30) return 'danger'
  if (weight >= 10) return 'warning'
  return 'neutral'
}

/**
 * Shows the guard over the page. `base` is where ds/ lives: chrome.runtime.getURL('') in the
 * content script, or './' on the preview page. Returns a function that removes it.
 */
export function showClickGuard(input: GuardInput, choice: GuardChoice, base: string): () => void {
  document.getElementById(HOST_ID)?.remove()
  loadFonts(base)

  const host = el('div', { id: HOST_ID })
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647' })
  const root = host.attachShadow({ mode: 'closed' })

  const v = input.verdict
  const meta = VERDICTS[v.verdict]
  const close = (): void => {
    host.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  const pick = (fn: () => void) => () => {
    close()
    fn()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      pick(choice.back)()
    }
  }

  const dialog = el(
    'div',
    { className: 'guard', role: 'alertdialog' },
    el(
      'div',
      { className: 'guard__top' },
      badge(meta.level, meta.label),
      el('p', { className: 'ae-label' }, 'Aegis stopped this click')
    ),
    el('h2', { className: 'guard__title', id: 'aegis-guard-title' }, input.headline),
    el(
      'div',
      { className: 'guard__compare' },
      el('p', { className: 'ae-label' }, 'The link said'),
      el('p', { className: 'guard__mono' }, input.linkText || '(no text)'),
      el('p', { className: 'ae-label guard__gap' }, 'It actually goes to'),
      el(
        'p',
        { className: `guard__mono guard__mono--${meta.level}` },
        v.urlStripped.replace(/^[a-z]+:\/\//i, '')
      )
    ),
    el(
      'div',
      { className: 'guard__chips' },
      ...v.reasons.map((r) =>
        el('span', { className: `chip chip--${chipTone(r.weight, r.hard)}` }, r.text)
      )
    ),
    el(
      'div',
      { className: 'guard__actions' },
      button('primary', 'Back to safety', pick(choice.back), { size: 'sm' }),
      button('secondary', 'Inspect in sandbox', pick(choice.inspect), { size: 'sm' }),
      button('ghost', 'Continue anyway', pick(choice.proceed), { size: 'sm' }),
      button('ghost', 'Trust this site', pick(choice.trust), { size: 'sm' })
    ),
    el(
      'p',
      { className: 'guard__foot' },
      `Checked in ${(input.checkedMs / 1000).toFixed(1)} s · nothing was sent to the site · fn opens Aegis`
    )
  )
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'aegis-guard-title')

  const theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  root.append(
    el('link', { rel: 'stylesheet', href: `${base}ds/tokens.css` }),
    el('link', { rel: 'stylesheet', href: `${base}ds/bundle.css` }),
    el('link', { rel: 'stylesheet', href: `${base}guard.css` }),
    el('div', { className: 'scrim', dataset: { theme } }, dialog)
  )
  document.addEventListener('keydown', onKey, true)
  document.documentElement.append(host)
  // Focus the safe choice so Enter goes back, not through.
  setTimeout(() => dialog.querySelector<HTMLButtonElement>('.ae-btn--primary')?.focus(), 0)
  return close
}
