// Popup: app status, counts for the current page, last five verdicts (MEGA_PROMPT §5.1).
// Plain DOM over the design system's classes, so the popup matches the app.

import type { StatusResponse } from '@shared/bridge'
import { fetchStatus } from './bridge'

const PROTECTION: Record<StatusResponse['protection'], { level: string; label: string }> = {
  protected: { level: 'secure', label: 'Protected' },
  scanning: { level: 'medium', label: 'Scanning' },
  degraded: { level: 'high', label: 'Degraded' },
  blocked: { level: 'critical', label: 'Blocked a threat' },
  paused: { level: 'low', label: 'Paused' }
}

const SHIELD =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function icon(paths: string[], size = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  for (const [k, v] of Object.entries({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }))
    svg.setAttribute(k, String(v))
  svg.classList.add('ae-icon')
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    svg.append(p)
  }
  return svg
}

function badge(level: string, label: string): HTMLElement {
  return el('span', { className: `ae-badge ae-badge--${level}` }, el('span', {}, label))
}

function alert(tone: 'warning' | 'info', title: string, text: string): HTMLElement {
  return el(
    'div',
    { className: `ae-alert ae-alert--${tone}`, role: 'status' },
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
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
  const status = await fetchStatus()
  const p = status ? PROTECTION[status.protection] : { level: 'high', label: 'Not connected' }

  app.replaceChildren(
    el(
      'header',
      { className: 'head' },
      el('div', { className: 'brand' }, icon([SHIELD, 'm9 12 2 2 4-4']), el('span', {}, 'Aegis')),
      badge(p.level, p.label)
    ),
    status
      ? alert(
          'info',
          `Connected to the Aegis app ${status.version}`,
          status.mode === 'block'
            ? 'Risky downloads are held until you decide.'
            : 'Warn mode: downloads are delivered with a verdict.'
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
        ...[
          ['—', 'No threats'],
          ['—', 'Caution'],
          ['—', 'Danger']
        ].map(([n, l]) => el('div', { className: 'count' }, el('b', {}, n), el('small', {}, l)))
      ),
      el('p', { className: 'quiet' }, 'Link checks on pages arrive in milestone 2.')
    ),
    section('Recent verdicts', el('p', { className: 'quiet' }, 'Nothing checked yet.'))
  )
}

void render()
