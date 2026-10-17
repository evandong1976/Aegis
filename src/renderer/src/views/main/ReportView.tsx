// Report (Figma frame "Report — invoice_oct.iso", MEGA_PROMPT §5.7): verdict header with risk
// score and actions; "What would have happened" beside indicators; code evidence beside
// capabilities and the checks that ran; the sandbox / privacy footer.

import { useEffect, useState } from 'react'
import type { ScanReport, Severity } from '@shared/types'
import { VERDICT_SENTENCE } from '@shared/verdicts'
import {
  Chip,
  CodeBlock,
  FindingChips,
  KeyValues,
  Label,
  ScanSteps,
  ScanningBadge,
  StatusDot,
  Timeline,
  VerdictBadge
} from '../../components/aegis'
import { Button, EmptyState } from '../../components/ds'
import { dayClock, displayUrl, shortClock, shortHash, size } from '../../lib/format'
import { liveState, useLiveRun } from '../../lib/live'
import LiveView, { SandboxPane } from './LiveView'

/** How long the live view stays up with the verdict before the Report replaces it. */
const LIVE_SETTLE_MS = 2500

function Panel({
  title,
  meta,
  children
}: {
  title: string
  meta?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="ae-card">
      <div className="ae-card__body flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <Label>{title}</Label>
          {meta ? <span className="mono-sm text-ink-subtle">{meta}</span> : null}
        </div>
        {children}
      </div>
    </section>
  )
}

const RISK_COLOR = {
  clean: 'text-success',
  unknown: 'text-info',
  suspicious: 'text-warning',
  malicious: 'text-danger'
} as const

function footer(r: ScanReport): string {
  const box = r.sandbox[0]
  if (box) {
    const where = box.provider === 'daytona' ? 'a Daytona sandbox' : 'a local Docker sandbox'
    const destroyed = box.destroyedAt
      ? `destroyed at ${shortClock(box.destroyedAt)}`
      : 'still running'
    return `Scanned in ${where} · ${destroyed} · your file never ran on this Mac`
  }
  if (r.kind === 'link') return 'Checked from this Mac · the link was not opened here'
  return 'Checked on this Mac · not uploaded'
}

export default function ReportView({
  scanId,
  onBack,
  onTitle
}: {
  scanId?: string
  onBack: () => void
  onTitle: (title: string | null) => void
}): React.JSX.Element {
  const [report, setReport] = useState<ScanReport | null | undefined>(undefined)

  useEffect(() => {
    if (!scanId) return
    let alive = true
    const load = (): void => {
      void window.aegis.invoke('scans:get', scanId).then((r) => alive && setReport(r))
    }
    load()
    const off = window.aegis.on('scans:changed', ({ id }) => id === scanId && load())
    return () => {
      alive = false
      off()
    }
  }, [scanId])

  // A scan opened in a sandbox while this app runs: the live view until the verdict settles.
  const run = useLiveRun(scanId)
  const endedAt = run?.events.find((e) => e.kind === 'end')?.at ?? null
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    if (!endedAt) return
    const left = Date.parse(endedAt) + LIVE_SETTLE_MS - Date.now()
    const t = setTimeout(() => setSettled(endedAt), Math.max(0, left))
    return () => clearTimeout(t)
  }, [endedAt])
  const showLive = Boolean(run && (!endedAt || settled !== endedAt))

  const name = report ? (report.filename ?? displayUrl(report.url)) : (run?.filename ?? null)
  useEffect(() => {
    onTitle(name)
    return () => onTitle(null)
  }, [name, onTitle])

  if (run && showLive) return <LiveView run={run} />

  if (!scanId || report === null) {
    return (
      <div className="ae-card">
        <EmptyState
          icon="file-search"
          title={scanId ? 'This report is not available' : 'No report open'}
          description={
            scanId
              ? 'The scan may have been deleted. Reports are kept on this Mac only.'
              : 'Open a row in Overview, Links or Downloads, or click a verdict in the mini panel.'
          }
          action={
            <Button variant="secondary" icon="arrow" onClick={onBack}>
              Back
            </Button>
          }
        />
      </div>
    )
  }
  if (report === undefined) return <div className="ae-card h-40" aria-busy="true" />

  const r = report
  // A link has reasons, not file findings: shown as chips weighted the way the click guard does.
  const findings =
    r.kind === 'link'
      ? r.reasons
          .filter((x) => x.weight > 0 || x.code === 'hidden_destination')
          .map((x) => ({
            title: x.text[0].toUpperCase() + x.text.slice(1),
            severity: (x.hard || x.weight >= 30
              ? 'critical'
              : x.weight >= 10
                ? 'high'
                : 'medium') as Severity
          }))
      : (r.stage1?.findings ?? [])
  const timeline = r.droid?.timeline ?? []
  const capabilities = r.stage1?.capabilities ?? []
  const isFile = r.kind !== 'link'
  const headline =
    r.summary ??
    r.droid?.summary ??
    (r.verdict ? `${VERDICT_SENTENCE[r.verdict]}.` : 'Aegis is still checking this.')

  return (
    <>
      {/* Verdict header */}
      <section className={`ae-card ${r.verdict === 'malicious' ? 'border-danger!' : ''}`}>
        <div className="ae-card__body flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {r.verdict ? <VerdictBadge verdict={r.verdict} /> : <ScanningBadge />}
            <span className="mono selectable min-w-0 truncate text-ink">{name}</span>
            {r.score != null && r.verdict ? (
              <span className="ml-auto flex items-baseline gap-1">
                <span className={`metric-md ${RISK_COLOR[r.verdict]}`}>{r.score}</span>
                <span className="mono-sm text-ink-subtle">/ 100 risk</span>
              </span>
            ) : null}
          </div>
          <p className="body-lg m-0 text-ink">{headline}</p>
          {findings.length > 0 ? (
            <FindingChips items={findings.map((f) => ({ title: f.title, severity: f.severity }))} />
          ) : r.reason ? (
            <div className="ae-chips">
              <Chip>{r.reason}</Chip>
            </div>
          ) : null}
          {isFile && r.verdict && r.verdict !== 'clean' ? (
            <div className="flex items-center gap-3">
              {/* Wired to quarantine.ts in milestone 8; disabled until then rather than pretending. */}
              <Button
                variant="danger"
                size="sm"
                disabled
                title="Arrives with quarantine handling (milestone 8)"
              >
                Delete file
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled
                title="Arrives with quarantine handling (milestone 8)"
              >
                Keep in quarantine
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled
                title="Arrives with quarantine handling (milestone 8)"
              >
                {r.kind === 'quarantine' ? 'Restore anyway' : 'Download anyway'}
              </Button>
            </div>
          ) : null}
          {r.action === 'scanning' ? (
            <ScanSteps
              steps={[
                { label: 'Pre-check', state: 'done' },
                { label: 'Analyzing', state: r.status === 'reviewing' ? 'done' : 'active' },
                { label: 'Droid reviewing', state: r.status === 'reviewing' ? 'active' : 'pending' }
              ]}
            />
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            title="What would have happened"
            meta={
              r.droid
                ? r.droid.reviewer === 'scripted'
                  ? 'Scripted stand-in for Droid'
                  : 'Reviewed by Droid'
                : undefined
            }
          >
            {timeline.length > 0 ? (
              <Timeline steps={timeline} />
            ) : (
              <p className="m-0 text-[13px] leading-[19px] text-ink-muted">
                {r.verdict === 'clean'
                  ? 'Nothing harmful found to describe.'
                  : !isFile
                    ? 'Aegis judges links without opening them, so there is no replay of the page. The reasons above and the checks on the right are what it found.'
                    : 'No step-by-step review for this scan. Droid reviews risky files after the first verdict.'}
              </p>
            )}
            {r.droid?.unknowns.length ? (
              <p className="m-0 text-[12px] leading-[17px] text-ink-subtle">
                Not known: {r.droid.unknowns.join(' ')}
              </p>
            ) : null}
          </Panel>

          {r.code.map((c) => (
            <Panel key={c.path} title="Code evidence" meta={`${c.path} · ${c.origin}`}>
              <CodeBlock excerpt={c} />
            </Panel>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Indicators">
            <KeyValues
              items={
                isFile
                  ? [
                      ['SHA-256', shortHash(r.indicators.sha256)],
                      ['Real type', r.indicators.realType ?? '—'],
                      ['Claimed type', r.indicators.claimedType ?? r.fileKind ?? '—'],
                      ['Signature', r.indicators.signature ?? '—'],
                      ['Size', size(r.indicators.size ?? r.size)],
                      ['First seen', dayClock(r.indicators.firstSeen ?? r.createdAt)]
                    ]
                  : [
                      ['URL', displayUrl(r.url)],
                      ['Seen in', r.seenIn],
                      ['Score', r.score != null ? `${r.score} / 100` : '—'],
                      ['Checked', dayClock(r.createdAt)]
                    ]
              }
            />
          </Panel>

          {capabilities.length > 0 ? (
            <Panel title="Capabilities">
              <div className="ae-chips">
                {capabilities.map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </div>
            </Panel>
          ) : null}

          {r.checks.length > 0 ? (
            <Panel title="Checks that ran">
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {r.checks.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3">
                    <StatusDot
                      state={
                        c.state === 'ok'
                          ? 'ok'
                          : c.state === 'warn'
                            ? 'degraded'
                            : c.state === 'fail'
                              ? 'down'
                              : 'unconfigured'
                      }
                      label={<span className="font-sans text-[13px] text-ink">{c.name}</span>}
                    />
                    <span
                      className={`mono-sm ${c.state === 'warn' ? 'text-warning' : c.state === 'fail' ? 'text-danger' : 'text-success'}`}
                    >
                      {c.result}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>

      {run ? (
        <SandboxPane
          state={liveState(run)}
          frame={run.frame}
          follow={false}
          className="h-[440px]"
        />
      ) : null}

      <p className="mono-sm m-0 text-ink-subtle">{footer(r)}</p>
    </>
  )
}
