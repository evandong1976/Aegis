// Popup: app status, counts for the current page, last five verdicts (MEGA_PROMPT §5.1).
// Plain DOM over the design system's classes, so the popup matches the app.

import type { StatusResponse } from '@shared/bridge'
import type { Verdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'
import { fetchStatus } from './bridge'
import { badge, el, icon } from './dom'
import type { RecentVerdict } from './messages'

const PROTECTION: Record<
  StatusResponse['protection'],
  { level: 'secure' | 'medium' | 'high' | 'critical' | 'low'; word: string }
> = {
  protected: { level: 'secure', word: 'Protected' },
  scanning: { level: 'medium', word: 'Scanning' },
  degraded: { level: 'high', word: 'Degraded' },
  blocked: { level: 'critical', word: 'Blocked a threat' },
  paused: { level: 'low', word: 'Paused' }
}

function alert(tone: 'warning' | 'info', title: string, text: string): HTMLElement {
  return el(
    'div',
    { className: `ae-alert ae-alert--${tone}`, role: 'status' },
    el('span', { className: 'ae-alert__icon' }, icon(tone === 'warning' ? 'alert' : 'info', 18)),
    el(
      'div',
      { className: 'ae-alert__body' },
      el('p', { className: 'ae-alert__title' }, title),
      el('p', { className: 'ae-alert__text' }, text)
    )
  )
}

function section(title: string, ...children: Node[]): HTMLElement {
  return el(
    'section',
    { className: 'section' },
    el('h2', { className: 'ae-label' }, title),
    ...children
  )
}

/** The active tab's link counts, from its content script; null on pages it can't run on. */
async function pageCounts(): Promise<Record<Verdict, number> | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) return null
    const reply = (await chrome.tabs.sendMessage(tab.id, { type: 'aegis:get-counts' })) as
      { counts: Record<Verdict, number> | null } | undefined
    return reply?.counts ?? null
  } catch {
    return null
  }
}

async function recentVerdicts(): Promise<RecentVerdict[]> {
  try {
    const got = await chrome.storage.session.get('recentVerdicts')
    return (got.recentVerdicts as RecentVerdict[] | undefined) ?? []
  } catch {
    return []
  }
}

async function render(): Promise<void> {
  const app = document.getElementById('app')!
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
  const [status, counts, recent] = await Promise.all([
    fetchStatus(),
    pageCounts(),
    recentVerdicts()
  ])
  const p = status
    ? PROTECTION[status.protection]
    : { level: 'high' as const, word: 'Not connected' }

  app.replaceChildren(
    el(
      'header',
      { className: 'head' },
      el('div', { className: 'brand' }, icon('shield-check'), el('span', {}, 'Aegis')),
      badge(p.level, p.word)
    ),
    status
      ? alert(
          'info',
          `Connected to the Aegis app ${status.version}`,
          status.mode === 'block'
            ? 'Risky downloads are held until you decide.'
            : 'Warn mode: downloads are delivered with their verdict.'
        )
      : alert(
          'warning',
          'Aegis app not running',
          'Downloads go straight to your Mac without a scan. Start Aegis to turn protection back on.'
        ),
    section(
      'This page',
      el(
        'div',
        { className: 'counts' },
        ...(['clean', 'unknown', 'suspicious', 'malicious'] as const).map((v) =>
          el(
            'div',
            { className: 'count' },
            el('b', {}, counts && status ? String(counts[v]) : '—'),
            el('small', {}, VERDICTS[v].label)
          )
        )
      ),
      el(
        'p',
        { className: 'quiet' },
        !status
          ? 'Links aren’t checked while the app is off.'
          : status.protection === 'paused'
            ? 'Paused: links aren’t checked.'
            : counts
              ? 'Every link on this page, judged without opening it.'
              : 'Reload this page to check its links.'
      )
    ),
    section(
      'Recent verdicts',
      recent.length
        ? el(
            'ul',
            { className: 'recent' },
            ...recent.map((r) =>
              el(
                'li',
                {},
                badge(VERDICTS[r.verdict].level, VERDICTS[r.verdict].label),
                el('span', { className: 'recent__domain' }, r.domain),
                el('small', { className: 'quiet' }, r.reason)
              )
            )
          )
        : el('p', { className: 'quiet' }, 'No links clicked yet.')
    )
  )
}

void render()
// Keep up with the app starting, stopping or pausing while the popup is open.
setInterval(() => void render(), 3000)
