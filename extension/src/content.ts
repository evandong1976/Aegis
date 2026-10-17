// Content script (MEGA_PROMPT §5.1, architectural.md §4.3): reads the page's links, asks the app
// for verdicts through the service worker (content scripts never call the bridge themselves),
// outlines risky links, explains them on hover, and holds clicks on Suspicious, Malicious and
// Unknown links behind the click guard. No link is ever opened to judge it (decision 20).
// If the app isn't running or protection is paused, links work exactly as they would without
// Aegis.

import type { PageResponse } from '@shared/bridge'
import type { LinkVerdict, Verdict } from '@shared/types'
import { linkHeadline, VERDICTS } from '@shared/verdicts'
import { badge, el } from './dom'
import { loadFonts, showClickGuard } from './guard'
import type { ContentMessage, ContentReply } from './messages'

const BATCH_LIMIT = 2000
const TEXT_URL_LIMIT = 200
const SCAN_DEBOUNCE_MS = 500
const GUARDED: Verdict[] = ['unknown', 'suspicious', 'malicious']

let pageUrl = location.href
const verdicts = new Map<string, LinkVerdict>()
const sent = new Set<string>()
/** Links the user chose to open from the guard; not asked about again on this page. */
const allowed = new Set<string>()
let paused = false
let scanTimer: number | null = null
let lastCounts = ''

function send(message: ContentMessage): Promise<ContentReply | undefined> {
  return chrome.runtime.sendMessage(message).catch(() => undefined)
}

// ---- Reading the page ----

function isCheckable(href: string): boolean {
  return /^(https?|data|javascript):/i.test(href)
}

/** Same page, different #fragment: nothing to check. */
function isInPage(href: string): boolean {
  try {
    const u = new URL(href)
    const here = new URL(location.href)
    return (
      u.hash !== '' &&
      u.origin === here.origin &&
      u.pathname === here.pathname &&
      u.search === here.search
    )
  } catch {
    return false
  }
}

function anchors(): Array<HTMLAnchorElement | HTMLAreaElement> {
  return Array.from(document.links) as Array<HTMLAnchorElement | HTMLAreaElement>
}

function linkText(a: HTMLAnchorElement | HTMLAreaElement): string {
  const text = a instanceof HTMLAnchorElement ? a.innerText || a.textContent || '' : a.alt
  return (text || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

/** Plain-text URLs in the page (not inside links), capped. They're counted, not outlined. */
function textUrls(limit: number): string[] {
  const out: string[] = []
  if (!document.body || limit <= 0) return out
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('a, script, style, noscript, textarea, [contenteditable="true"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
  })
  const re = /\bhttps?:\/\/[^\s<>"'`()[\]{}]+/gi
  for (let n = walker.nextNode(); n && out.length < limit; n = walker.nextNode()) {
    for (const m of (n.textContent ?? '').matchAll(re)) {
      const url = m[0].replace(/[.,;:!?]+$/, '')
      if (out.length < limit) out.push(url)
    }
  }
  return out
}

function collect(): Array<{ href: string; text: string }> {
  const batch: Array<{ href: string; text: string }> = []
  for (const a of anchors()) {
    const href = a.href
    if (!href || sent.has(href) || !isCheckable(href) || isInPage(href)) continue
    sent.add(href)
    batch.push({ href, text: linkText(a) })
    if (batch.length >= BATCH_LIMIT) return batch
  }
  for (const href of textUrls(TEXT_URL_LIMIT)) {
    if (sent.has(href) || batch.length >= BATCH_LIMIT) continue
    sent.add(href)
    batch.push({ href, text: '' })
  }
  return batch
}

async function scan(): Promise<void> {
  scanTimer = null
  if (location.href !== pageUrl) reset()
  const batch = collect()
  if (batch.length === 0) {
    mark()
    return
  }
  const reply = await send({ type: 'aegis:page', pageUrl, links: batch })
  if (reply?.type !== 'aegis:page') {
    // The app isn't running: forget these so they're asked about once it is.
    for (const l of batch) sent.delete(l.href)
    return
  }
  apply(reply.response)
}

function apply(res: PageResponse): void {
  paused = res.paused
  for (const v of res.links) verdicts.set(v.url, v)
  mark()
}

function schedule(): void {
  if (scanTimer !== null) return
  scanTimer = window.setTimeout(() => void scan(), SCAN_DEBOUNCE_MS)
}

/** A new page in a single-page app (Gmail moving between messages): start over. */
function reset(): void {
  pageUrl = location.href
  verdicts.clear()
  sent.clear()
  allowed.clear()
  for (const a of document.querySelectorAll('[data-aegis-verdict]'))
    a.removeAttribute('data-aegis-verdict')
}

// ---- Marking links ----

const STYLE_ID = 'aegis-link-marks'
// One colour per verdict that reads on light and dark pages alike: the page's background doesn't
// follow the system theme, so the design system's theme pair doesn't fit here.
const MARK_CSS = `
a[data-aegis-verdict="suspicious"], area[data-aegis-verdict="suspicious"] {
  outline: 2px dotted #d98b00 !important; outline-offset: 2px !important; }
a[data-aegis-verdict="malicious"], area[data-aegis-verdict="malicious"] {
  outline: 2px dashed #e5243f !important; outline-offset: 2px !important; }
`

function mark(): void {
  if (!document.getElementById(STYLE_ID)) {
    document.documentElement.append(el('style', { id: STYLE_ID, textContent: MARK_CSS }))
  }
  const counts: Record<Verdict, number> = { clean: 0, unknown: 0, suspicious: 0, malicious: 0 }
  for (const v of verdicts.values()) counts[v.verdict]++
  for (const a of anchors()) {
    const v = paused ? undefined : verdicts.get(a.href)
    const want = v && GUARDED.includes(v.verdict) && !allowed.has(a.href) ? v.verdict : null
    if (want) {
      if (a.getAttribute('data-aegis-verdict') !== want) a.setAttribute('data-aegis-verdict', want)
    } else if (a.hasAttribute('data-aegis-verdict')) {
      a.removeAttribute('data-aegis-verdict')
    }
  }
  const key = paused ? 'paused' : JSON.stringify(counts)
  if (key !== lastCounts) {
    lastCounts = key
    void send({ type: 'aegis:counts', counts: paused ? null : counts })
  }
}

// ---- Hover note ----

let tip: { host: HTMLElement; root: ShadowRoot } | null = null

/** Packaged files are reachable from the page only at their dynamic URL, one file at a time. */
const asset = (path: string): string => chrome.runtime.getURL(path)

function showTip(a: Element, v: LinkVerdict): void {
  if (!tip) {
    loadFonts(asset)
    const host = el('div', { id: 'aegis-link-note' })
    Object.assign(host.style, { position: 'fixed', zIndex: '2147483646', pointerEvents: 'none' })
    const root = host.attachShadow({ mode: 'closed' })
    tip = { host, root }
  }
  const meta = VERDICTS[v.verdict]
  const theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  tip.root.replaceChildren(
    el('link', { rel: 'stylesheet', href: asset('ds/tokens.css') }),
    el('link', { rel: 'stylesheet', href: asset('ds/bundle.css') }),
    el('link', { rel: 'stylesheet', href: asset('guard.css') }),
    el(
      'div',
      { className: 'note', dataset: { theme } },
      el(
        'div',
        { className: 'note__top' },
        badge(meta.level, meta.label),
        el('span', { className: 'ae-label' }, 'Aegis')
      ),
      el('p', { className: 'note__title' }, linkHeadline(v)),
      ...v.reasons
        .filter((r) => r.weight > 0 || r.code === 'hidden_destination')
        .slice(0, 3)
        .map((r) => el('p', { className: 'note__reason' }, r.text))
    )
  )
  const r = a.getBoundingClientRect()
  const below = r.bottom + 8 + 120 < innerHeight
  Object.assign(tip.host.style, {
    left: `${Math.max(8, Math.min(r.left, innerWidth - 328))}px`,
    top: below ? `${r.bottom + 8}px` : '',
    bottom: below ? '' : `${innerHeight - r.top + 8}px`
  })
  if (!tip.host.isConnected) document.documentElement.append(tip.host)
}

function hideTip(): void {
  tip?.host.remove()
}

document.addEventListener(
  'mouseover',
  (e) => {
    const a = (e.target as Element | null)?.closest?.(
      'a[data-aegis-verdict], area[data-aegis-verdict]'
    )
    const v = a ? verdicts.get((a as HTMLAnchorElement).href) : undefined
    if (a && v) showTip(a, v)
    else hideTip()
  },
  true
)
addEventListener('scroll', hideTip, { capture: true, passive: true })

// ---- The click ----

function anchorFrom(e: MouseEvent): HTMLAnchorElement | HTMLAreaElement | null {
  for (const n of e.composedPath()) {
    if ((n instanceof HTMLAnchorElement || n instanceof HTMLAreaElement) && n.href) return n
  }
  return null
}

/** Opens the link the way the click would have: same tab, new tab, or a named frame. */
function open(a: HTMLAnchorElement | HTMLAreaElement, e: MouseEvent): void {
  const target = a.target
  const newTab = e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey || target === '_blank'
  if (newTab) window.open(a.href, '_blank', 'noopener')
  else if (target && !['_self', '_top', '_parent'].includes(target)) window.open(a.href, target)
  else if (target === '_top') window.top?.location.assign(a.href)
  else location.assign(a.href)
}

function stop(e: MouseEvent): void {
  e.preventDefault()
  e.stopImmediatePropagation()
}

function isFinal(v: LinkVerdict): boolean {
  return !Object.values(v.checks).some((s) => s === 'timeout')
}

async function report(
  clickId: string | undefined,
  href: string,
  text: string,
  decision: 'allowed' | 'held' | 'blocked',
  verdictMs: number,
  trusted = false
): Promise<string | undefined> {
  const v = verdicts.get(href)
  const recent =
    !clickId && v
      ? {
          domain: v.domain || v.urlStripped,
          verdict: v.verdict,
          reason: v.verdict === 'clean' ? 'No threats found' : (v.reasons[0]?.text ?? ''),
          at: new Date().toISOString()
        }
      : undefined
  const reply = await send({
    type: 'aegis:click',
    click: { clickId, pageUrl, href, linkText: text, decision, verdictMs, trusted, recent }
  })
  return reply?.type === 'aegis:click' ? reply.clickId : undefined
}

async function onClick(e: MouseEvent): Promise<void> {
  if (!e.isTrusted || paused) return
  if (e.type === 'click' && e.button !== 0) return
  if (e.type === 'auxclick' && e.button !== 1) return
  const a = anchorFrom(e)
  if (!a) return
  const href = a.href
  if (!isCheckable(href) || isInPage(href) || /^javascript:/i.test(href)) return
  if (location.href !== pageUrl) reset()
  if (allowed.has(href)) return

  const text = linkText(a)
  let v = verdicts.get(href)
  if (v && isFinal(v)) {
    if (!GUARDED.includes(v.verdict)) {
      void report(undefined, href, text, 'allowed', 0)
      return
    }
    stop(e)
    guard(a, e, v, text, v.checkedMs ?? 0)
    return
  }

  // Not checked yet, or its lookups were still running: hold the click for the answer.
  stop(e)
  const started = performance.now()
  sent.add(href)
  const reply = await send({ type: 'aegis:page', pageUrl, links: [{ href, text }], urgent: true })
  const ms = performance.now() - started
  if (reply?.type !== 'aegis:page' || reply.response.paused) {
    // The app isn't running or protection is paused: the link opens as normal.
    if (reply?.type === 'aegis:page') apply(reply.response)
    open(a, e)
    return
  }
  apply(reply.response)
  v = verdicts.get(href)
  if (!v || !GUARDED.includes(v.verdict)) {
    void report(undefined, href, text, 'allowed', ms)
    open(a, e)
    return
  }
  guard(a, e, v, text, ms)
}

function guard(
  a: HTMLAnchorElement | HTMLAreaElement,
  e: MouseEvent,
  v: LinkVerdict,
  text: string,
  ms: number
): void {
  hideTip()
  const href = a.href
  const clickId = report(undefined, href, text, 'held', ms)
  const decide = (decision: 'allowed' | 'blocked', trusted = false): void => {
    void clickId.then((id) => id && report(id, href, text, decision, ms, trusted))
  }
  const hidden = v.reasons.some((r) => r.code === 'hidden_destination')
  showClickGuard(
    {
      verdict: v,
      linkText: text,
      headline: linkHeadline(v),
      checkedMs: ms,
      canTrust: !hidden && v.domain !== '' && /^https?:/i.test(href)
    },
    {
      back: () => decide('blocked'),
      proceed: () => {
        allowed.add(href)
        mark()
        decide('allowed')
        open(a, e)
      },
      trust: () => {
        void send({ type: 'aegis:trust', domain: v.domain })
        for (const [h, x] of verdicts) if (x.domain === v.domain) allowed.add(h)
        mark()
        decide('allowed', true)
        open(a, e)
      }
    },
    asset
  )
}

addEventListener('click', (e) => void onClick(e), true)
addEventListener('auxclick', (e) => void onClick(e), true)

// ---- Start, and keep up with the page ----

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['href']
})
addEventListener('popstate', schedule)
addEventListener('hashchange', schedule)

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  // The popup asks for this page's counts.
  if (message?.type === 'aegis:get-counts') {
    const counts: Record<Verdict, number> = { clean: 0, unknown: 0, suspicious: 0, malicious: 0 }
    for (const v of verdicts.values()) counts[v.verdict]++
    sendResponse({ counts: paused ? null : counts })
  }
  return false
})

void scan()
