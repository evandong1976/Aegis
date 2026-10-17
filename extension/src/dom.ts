// Tiny DOM helpers for extension UI (popup, click guard). Same markup and `ae-*` classes as the
// app's components, so design-system/components/bundle.css styles them.

import { PATHS } from '@shared/icons'
import type { BadgeLevel } from '@shared/verdicts'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: Array<Node | string | null | false>
): HTMLElementTagNameMap[K] {
  const { dataset, ...rest } = props
  const node = Object.assign(document.createElement(tag), rest)
  if (dataset) Object.assign(node.dataset, dataset)
  node.append(...(children.filter(Boolean) as Array<Node | string>))
  return node
}

export function icon(name: string, size = 20, strokeWidth = 1.75): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const attrs: Record<string, string | number> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false'
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v))
  svg.classList.add('ae-icon')
  for (const d of PATHS[name] ?? PATHS.shield) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    svg.append(p)
  }
  return svg
}

const BADGE_ICON: Record<BadgeLevel, string> = {
  critical: 'shield-alert',
  high: 'alert',
  medium: 'info',
  low: 'activity',
  secure: 'check-circle'
}

/** SeverityBadge: always icon + word. */
export function badge(level: BadgeLevel, word: string): HTMLElement {
  return el(
    'span',
    { className: `ae-badge ae-badge--${level}` },
    icon(BADGE_ICON[level], 13, 2),
    el('span', {}, word)
  )
}

export function button(
  variant: 'primary' | 'secondary' | 'ghost' | 'danger',
  label: string,
  onClick: () => void,
  opts: { size?: 'sm' | 'md'; icon?: string } = {}
): HTMLButtonElement {
  const b = el(
    'button',
    { type: 'button', className: `ae-btn ae-btn--${variant} ae-btn--${opts.size ?? 'md'}` },
    opts.icon ? icon(opts.icon, opts.size === 'sm' ? 15 : 17) : null,
    el('span', {}, label)
  )
  b.addEventListener('click', onClick)
  return b
}
