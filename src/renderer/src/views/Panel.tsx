// The mini panel (#/panel), following the Figma frame "Mini panel — 360×480" and MEGA_PROMPT §5.8:
// status + four service dots, this page, scanning now, recent verdicts, pause / open.
// Esc closes it, ⌘O opens the main window, ⌘P pauses for 15 min.

import { useEffect } from 'react'
import type { ScanSummary, ServiceKey, ServiceState, Verdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'
import { Label, ScanSteps, StatusDot, VerdictBadge, type StepState } from '../components/aegis'
import { Button } from '../components/ds'
import { displayUrl, shortClock } from '../lib/format'
import { useInvoke, useStatus } from '../lib/hooks'
import { liveState, useLiveRun } from '../lib/live'

const DOTS: Array<[ServiceKey, string]> = [
  ['daytona', 'Daytona'],
  ['droid', 'Droid'],
  ['photon', 'Photon'],
  ['chalk', 'Chalk']
]

const PROTECTION: Record<string, { word: string; tone: string }> = {
  protected: { word: 'Protected', tone: 'success' },
  scanning: { word: 'Scanning', tone: 'accent' },
  degraded: { word: 'Degraded', tone: 'warning' },
  blocked: { word: 'Blocked', tone: 'danger' },
  paused: { word: 'Paused', tone: 'neutral' }
}

function steps(s: ScanSummary): Array<{ label: string; state: StepState }> {
  const order = ['received', 'prechecked', 'uploaded', 'analyzing', 'verdict', 'reviewing', 'done']
  const at = order.indexOf(s.status)
  const state = (doneAfter: number, activeAt: number[]): StepState =>
    at > doneAfter ? 'done' : activeAt.includes(at) ? 'active' : 'pending'
  return [
    { label: 'Pre-check', state: state(1, [0, 1]) },
    { label: 'Analyzing', state: state(4, [2, 3, 4]) },
    { label: 'Droid reviewing', state: state(5, [5]) }
  ]
}

/** The live run in one line: the stage in progress and what it is doing. */
function liveLine(s: ReturnType<typeof liveState>): string | null {
  const order = ['agent', 'opened', 'sandbox', 'caught'] as const
  const active = order.find((k) => s.stages[k].state === 'active')
  if (s.end) return null
  if (!active) return s.desktop?.state === 'starting' ? 'Starting the sandbox desktop…' : 'Working…'
  const word = {
    caught: 'Caught',
    sandbox: 'Starting the sandbox',
    opened: 'Opening it in the sandbox',
    agent: 'Droid reviewing'
  }[active]
  const last = s.agent[s.agent.length - 1]
  return active === 'agent' && last?.step === 'tool' ? `${word} · ${last.tool}` : `${word}…`
}

function Card({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="panel-card">
      <Label>{title}</Label>
      {children}
    </section>
  )
}

export default function Panel(): React.JSX.Element {
  const status = useStatus()
  const { data: recent, reload } = useInvoke('scans:list', { kind: 'any', limit: 12 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.aegis.send('panel:hide')
      else if (e.metaKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        window.aegis.send('main:open')
      } else if (e.metaKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        void window.aegis.invoke('protection:pause')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(reload, [status, reload])

  const health = status?.health ?? []
  const stateOf = (key: ServiceKey): ServiceState =>
    health.find((h) => h.key === key)?.state ?? 'pending'
  const live = (recent ?? []).filter((s) => s.action === 'scanning').slice(0, 1)
  // A scan opened in a sandbox right now: one line on what is happening, and a way to watch.
  const run = useLiveRun(live[0]?.id)
  const now = run ? liveLine(liveState(run)) : null
  const done = (recent ?? []).filter((s) => s.verdict).slice(0, 2)
  const p = PROTECTION[status?.protection ?? 'protected']
  const paused = status?.protection === 'paused'
  const page = status?.page
  const extensionOk = stateOf('bridge') === 'ok' || Boolean(page)

  return (
    <div className="panel-shell flex h-full flex-col gap-2.5 overflow-hidden px-3.5 pt-3 pb-3.5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-display text-[18px] leading-6 font-semibold text-accent">
            Aegis
          </span>
          <span
            className={`ae-chip ae-chip--${p.tone} font-sans! font-bold! tracking-[0.06em] uppercase`}
          >
            <span
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
            {paused && status?.pausedUntil
              ? `Paused until ${shortClock(status.pausedUntil)}`
              : p.word}
          </span>
        </div>
        <div className="flex gap-3">
          {DOTS.map(([key, label]) => (
            <StatusDot key={key} state={stateOf(key)} label={label} />
          ))}
        </div>
      </header>

      <main className="scroll-quiet flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <Card title="This page">
          {page ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(page.counts) as Array<[Verdict, number]>)
                  .filter(([, n]) => n > 0)
                  .sort(([a], [b]) => VERDICTS[a].rank - VERDICTS[b].rank)
                  .map(([v, n]) => (
                    <VerdictBadge key={v} verdict={v}>
                      {n} {VERDICTS[v].label}
                    </VerdictBadge>
                  ))}
              </div>
              {page.top ? (
                <p className="m-0 truncate text-[12px] leading-[17px] text-ink-muted">
                  <span className="font-mono text-ink">{page.top.domain}</span> · {page.top.reason}
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-[12px] leading-[17px] text-ink-muted">
              {extensionOk
                ? 'Link counts for the open tab arrive with link checks (milestone 2).'
                : 'Extension not connected. Load extension/dist in chrome://extensions.'}
            </p>
          )}
        </Card>

        <Card title="Scanning now">
          {live.length > 0 ? (
            live.map((s) => (
              <div key={s.id} className="flex flex-col gap-1.5">
                <span className="mono truncate text-ink">{s.filename ?? displayUrl(s.url)}</span>
                {now ? (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] leading-[17px] text-ink-muted">
                      {now}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => window.aegis.send('main:open', 'report', s.id)}
                    >
                      Watch
                    </Button>
                  </div>
                ) : (
                  <ScanSteps steps={steps(s)} />
                )}
              </div>
            ))
          ) : (
            <p className="m-0 text-[12px] leading-[17px] text-ink-muted">
              Nothing scanning. Downloads show their steps here while Aegis checks them.
            </p>
          )}
        </Card>

        <Card title="Recent verdicts">
          {done.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {done.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => window.aegis.send('main:open', 'report', s.id)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-none bg-transparent p-0 text-left"
                  >
                    {s.verdict ? <VerdictBadge verdict={s.verdict} /> : null}
                    <span className="mono-sm min-w-0 flex-1 truncate text-ink">
                      {s.filename ?? displayUrl(s.url)}
                    </span>
                    <span className="mono-sm text-ink-subtle">{shortClock(s.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[12px] leading-[17px] text-ink-muted">Nothing checked yet.</p>
          )}
        </Card>
      </main>

      <footer className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button
            size="sm"
            variant="secondary"
            full
            onClick={() => void window.aegis.invoke('protection:resume')}
          >
            Resume
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            full
            onClick={() => void window.aegis.invoke('protection:pause')}
          >
            Pause 15 min
          </Button>
        )}
        <Button size="sm" full onClick={() => window.aegis.send('main:open')}>
          Open Aegis
        </Button>
      </footer>
    </div>
  )
}
