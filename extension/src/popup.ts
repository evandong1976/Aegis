// Popup: app status, counts for the current page, last five verdicts (MEGA_PROMPT §5.1).
// Plain DOM over the design system's classes, so the popup matches the app.

import type { StatusResponse } from '@shared/bridge'
import { fetchStatus } from './bridge'
import { badge, el, icon } from './dom'

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

async function render(): Promise<void> {
  const app = document.getElementById('app')!
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
  const status = await fetchStatus()
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
        ...['Clean', 'Suspicious', 'Malicious'].map((l) =>
          el('div', { className: 'count' }, el('b', {}, '—'), el('small', {}, l))
        )
      ),
      el('p', { className: 'quiet' }, 'Link checks on pages arrive in milestone 2.')
    ),
    section('Recent verdicts', el('p', { className: 'quiet' }, 'Nothing checked yet.'))
  )
}

void render()
// Keep up with the app starting, stopping or pausing while the popup is open.
setInterval(() => void render(), 3000)
