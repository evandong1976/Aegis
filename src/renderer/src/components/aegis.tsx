// Aegis components from the Figma file (figma/built.md): VerdictBadge, StatusDot, ScanStep,
// TimelineStep, CodeBlock (CodeLine), finding chips and a key/value list. Styles: assets/aegis.css.

import type { ReactNode } from 'react'
import type { CodeExcerpt, ServiceState, Severity, TimelineStep, Verdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'
import { Icon, SeverityBadge } from './ds'

/** The only way a verdict is drawn: icon + word + colour, from src/shared/verdicts.ts. */
export function VerdictBadge({
  verdict,
  subtle,
  children
}: {
  verdict: Verdict
  subtle?: boolean
  /** Replaces the word, e.g. "1 malicious"; the icon and colour stay. */
  children?: ReactNode
}): React.JSX.Element {
  const v = VERDICTS[verdict]
  return (
    <SeverityBadge level={v.level} subtle={subtle}>
      {children ?? v.label}
    </SeverityBadge>
  )
}

/** A scan that has no verdict yet. */
export function ScanningBadge(): React.JSX.Element {
  return (
    <SeverityBadge level="low" subtle>
      Scanning
    </SeverityBadge>
  )
}

/** StatusDot: Ok · Degraded · Down. `unconfigured` and `pending` draw as Off. Always with a word. */
export function StatusDot({
  state,
  label
}: {
  state: ServiceState
  label: ReactNode
}): React.JSX.Element {
  const tone =
    state === 'ok' ? 'ok' : state === 'down' ? 'down' : state === 'degraded' ? 'degraded' : 'off'
  return (
    <span className={`ae-dot ae-dot--${tone}`}>
      <span className="ae-dot__mark" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export type StepState = 'done' | 'active' | 'pending'
const STEP_ICON: Record<StepState, string> = { done: 'check', active: 'scan', pending: 'info' }

/** ScanStep: Done · Active · Pending. */
export function ScanSteps({
  steps
}: {
  steps: Array<{ label: string; state: StepState }>
}): React.JSX.Element {
  return (
    <ol className="ae-steps">
      {steps.map((s) => (
        <li key={s.label} className={`ae-step ae-step--${s.state}`}>
          <span className="ae-step__icon">
            <Icon name={STEP_ICON[s.state]} size={15} strokeWidth={2} />
          </span>
          <span>{s.label}</span>
          {s.state === 'active' ? <span className="sr-only">(in progress)</span> : null}
        </li>
      ))}
    </ol>
  )
}

/** TimelineStep list: "What would have happened". */
export function Timeline({ steps }: { steps: TimelineStep[] }): React.JSX.Element {
  return (
    <ol className="ae-timeline">
      {steps.map((s) => (
        <li key={s.step} className={`ae-tl ae-tl--${s.tone}`}>
          <span className="ae-tl__num" aria-hidden="true">
            {s.step}
          </span>
          <div>
            <p className="ae-tl__title">{s.title}</p>
            <p className="ae-tl__detail">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** CodeLine: Normal · Flagged. Flagged lines carry the finding's title under the code. */
export function CodeBlock({ excerpt }: { excerpt: CodeExcerpt }): React.JSX.Element {
  const flags = new Map(excerpt.flags.map((f) => [f.line, f]))
  return (
    <div
      className="ae-code"
      role="group"
      aria-label={`${excerpt.path}, lines ${excerpt.startLine}–${excerpt.startLine + excerpt.lines.length - 1}`}
    >
      {excerpt.lines.map((text, i) => {
        const n = excerpt.startLine + i
        const flag = flags.get(n)
        return (
          <div key={n} className={`ae-code__line${flag ? ' ae-code__line--flagged' : ''}`}>
            <span className="ae-code__num">{n}</span>
            <span className="ae-code__text">{text}</span>
            {flag ? <span className="ae-code__flag">{flag.title}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

const CHIP_TONE: Record<Severity, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral'
}

export function Chip({
  tone = 'neutral',
  children
}: {
  tone?: string
  children: ReactNode
}): React.JSX.Element {
  return <span className={`ae-chip ae-chip--${tone}`}>{children}</span>
}

export function FindingChips({
  items
}: {
  items: Array<{ title: string; severity: Severity }>
}): React.JSX.Element {
  return (
    <div className="ae-chips">
      {items.map((f) => (
        <Chip key={f.title} tone={CHIP_TONE[f.severity]}>
          {f.title}
        </Chip>
      ))}
    </div>
  )
}

export function KeyValues({ items }: { items: Array<[string, ReactNode]> }): React.JSX.Element {
  return (
    <dl className="ae-kv">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Uppercase section label used inside cards and the panel (the `label` style). */
export function Label({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return <p className={`ae-label m-0 ${className ?? ''}`}>{children}</p>
}
