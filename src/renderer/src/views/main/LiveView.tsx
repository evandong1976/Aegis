// The live view (feature/visualization): a caught file being opened in a network-off Daytona
// sandbox and reverse engineered, as it happens. Stages across the top; Droid on the left, on
// this Mac, reaching into the sandbox through read-only tools (decision 19); the sandbox on the
// right with Terminal and Desktop tabs, like Daytona's playground. The Report replaces it when
// the verdict lands (ReportView), and keeps the sandbox session as a card.

import { useEffect, useRef, useState } from 'react'
import type { LiveRun, LiveStage } from '@shared/live'
import { VERDICT_SENTENCE } from '@shared/verdicts'
import { Chip, Label, ScanningBadge, StatusDot, VerdictBadge } from '../../components/aegis'
import { Icon, Tabs } from '../../components/ds'
import type { IconName } from '../../components/ds/icons'
import { shortHash, size } from '../../lib/format'
import { liveState, type LiveState, type StageState } from '../../lib/live'

const STAGE: Record<LiveStage, { label: string; icon: IconName }> = {
  caught: { label: 'Caught', icon: 'shield' },
  sandbox: { label: 'Sandbox, network off', icon: 'box' },
  opened: { label: 'Opened in the sandbox', icon: 'play' },
  agent: { label: 'Reverse engineering', icon: 'file-search' },
  verdict: { label: 'Verdict', icon: 'shield-check' }
}

const STAGE_ICON: Record<StageState, IconName | null> = {
  pending: null,
  active: null,
  done: 'check',
  failed: 'x'
}

function useElapsed(run: LiveRun, end: string | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (end) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [end])
  const ms = Math.max(0, (end ? Date.parse(end) : now) - Date.parse(run.startedAt))
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function StageRail({ state }: { state: LiveState }): React.JSX.Element {
  return (
    <ol className="ae-live-stages">
      {(Object.keys(STAGE) as LiveStage[]).map((key) => {
        const st = state.stages[key]
        const glyph = STAGE_ICON[st.state] ?? STAGE[key].icon
        return (
          <li key={key} className={`ae-live-stage ae-live-stage--${st.state}`}>
            <span className="ae-live-stage__icon">
              <Icon name={glyph} size={15} strokeWidth={2} />
            </span>
            <span className="ae-live-stage__label">{STAGE[key].label}</span>
            {st.detail ? <span className="ae-live-stage__detail">{st.detail}</span> : null}
            {st.state === 'active' ? <span className="sr-only">(in progress)</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/** Keeps a scrolling box pinned to its newest line unless the user has scrolled up. */
function useFollow<T extends HTMLElement>(dep: unknown): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  // Decided on scroll, not after new lines land: a tall block must not unpin the box.
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

const PROMPT: Record<string, string> = { aegis: '$', sample: '+', agent: 'droid ›' }

export function Terminal({ state }: { state: LiveState }): React.JSX.Element {
  const ref = useFollow<HTMLDivElement>(state.term.length)
  return (
    <div ref={ref} className="ae-term" data-theme="dark" role="log" aria-label="Sandbox terminal">
      {state.term.length === 0 ? (
        <p className="ae-term__line ae-term__line--note">Waiting for the sandbox…</p>
      ) : (
        state.term.map((l) => (
          <p
            key={l.seq}
            className={`ae-term__line ae-term__line--${l.stream} ae-term__src--${l.source}`}
          >
            {l.stream === 'cmd' ? (
              <span className="ae-term__prompt">{PROMPT[l.source]}</span>
            ) : null}
            {l.stream === 'blocked' ? <span className="ae-term__tag">✕ blocked</span> : null}
            {l.stream === 'file' ? <span className="ae-term__tag">wrote</span> : null}
            {l.stream === 'note' ? <span className="ae-term__prompt">#</span> : null}
            <span className="ae-term__text">{l.text}</span>
          </p>
        ))
      )}
    </div>
  )
}

export function Desktop({
  state,
  frame
}: {
  state: LiveState
  frame: LiveRun['frame']
}): React.JSX.Element {
  const d = state.desktop
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="ae-desktop" data-theme="dark">
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame.jpeg}`}
            alt="The sandbox's desktop, with the file open in a terminal window"
          />
        ) : (
          <p className="ae-desktop__empty">
            {d?.state === 'off'
              ? d.detail
              : d?.state === 'starting'
                ? 'Starting the sandbox desktop…'
                : 'The desktop starts once the network is proven off.'}
          </p>
        )}
      </div>
      <figcaption className="mono-sm text-ink-subtle">
        {d?.state === 'on'
          ? "The sandbox's own Linux desktop, refreshed every second. The file opens in a terminal window there, never on your Mac."
          : (d?.detail ?? 'Daytona Computer Use: Xvfb + xfce4 inside the sandbox.')}
      </figcaption>
    </figure>
  )
}

type SandboxTab = 'terminal' | 'desktop'

export function SandboxPane({
  state,
  frame,
  follow = true,
  className
}: {
  state: LiveState
  frame: LiveRun['frame']
  /** Switch tabs with the run (Desktop while the file is open) until the user picks one. */
  follow?: boolean
  className?: string
}): React.JSX.Element {
  const [picked, setPicked] = useState<SandboxTab | null>(null)
  // Desktop while the file is open and until Droid's first tool call, then the terminal, where
  // its commands land.
  const showDesktop =
    state.stages.opened.state === 'active' ||
    (state.stages.agent.state === 'active' && !state.agent.some((a) => a.step === 'tool'))
  const auto: SandboxTab =
    follow && state.desktop?.state === 'on' && showDesktop ? 'desktop' : 'terminal'
  const tab = picked ?? (follow ? auto : 'terminal')
  const box = state.sandbox
  return (
    <section
      className={`ae-card ae-live-sandbox ${state.reaching ? 'ae-card--glow' : ''} ${className ?? ''}`}
    >
      <div className="ae-card__body flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Label>Daytona sandbox</Label>
          {box ? (
            <span className="mono-sm text-ink-subtle">{box.sandboxId.slice(0, 8)}</span>
          ) : null}
          <StatusDot state={box ? 'ok' : 'pending'} label="Network off" />
          <Tabs<SandboxTab>
            className="ml-auto"
            value={tab}
            onChange={setPicked}
            items={[
              { label: 'Terminal', value: 'terminal' },
              { label: 'Desktop', value: 'desktop' }
            ]}
          />
        </div>
        {tab === 'terminal' ? <Terminal state={state} /> : <Desktop state={state} frame={frame} />}
      </div>
    </section>
  )
}

function AgentPane({ run, state }: { run: LiveRun; state: LiveState }): React.JSX.Element {
  const ref = useFollow<HTMLOListElement>(state.agent.length)
  const scripted = run.agent.mode === 'scripted'
  const waiting =
    state.stages.agent.state === 'pending'
      ? state.stages.opened.state === 'failed' || state.stages.sandbox.state === 'failed'
        ? 'The review did not start.'
        : 'Waits until the file has been opened in the sandbox.'
      : 'Starting…'
  return (
    <section className="ae-card ae-live-agent">
      <div className="ae-card__body flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label>{run.agent.name} · on this Mac</Label>
          {scripted ? (
            <span title="The words are scripted until workerA.ts runs the real Droid session (milestone 4). The tool calls are real: each one runs inside the sandbox.">
              <Chip tone="warning">Scripted stand-in</Chip>
            </span>
          ) : null}
        </div>
        <p className="m-0 text-[12px] leading-[17px] text-ink-muted">
          Reaches the file only through read-only tools that run inside the sandbox. No network, no
          other files.
        </p>
        <ol ref={ref} className="ae-agent">
          {state.agent.length === 0 ? (
            <li className="ae-agent__thought text-ink-subtle">{waiting}</li>
          ) : (
            state.agent.map((a, i) => {
              const last = i === state.agent.length - 1
              if (a.step === 'thought') {
                return (
                  <li key={a.seq} className="ae-agent__thought">
                    {a.text}
                  </li>
                )
              }
              if (a.step === 'tool') {
                return (
                  <li
                    key={a.seq}
                    className={`ae-agent__tool ${last && state.reaching ? 'is-reaching' : ''}`}
                  >
                    <span className="ae-agent__tool-head">
                      <Icon name="arrow" size={14} strokeWidth={2} />
                      <span className="mono text-ink">{a.tool}</span>
                      <span className="mono-sm text-ink-subtle">runs in the sandbox</span>
                    </span>
                    <code className="ae-agent__cmd">{a.command}</code>
                  </li>
                )
              }
              if (a.step === 'result') {
                return (
                  <li key={a.seq} className="ae-agent__result">
                    <span className="mono-sm text-ink-subtle">
                      exit {a.exitCode} · {size(a.bytes ?? 0)}
                    </span>
                    {a.text ? <pre className="ae-agent__out">{a.text}</pre> : null}
                  </li>
                )
              }
              return (
                <li key={a.seq} className="ae-agent__verdict">
                  {a.verdict ? <VerdictBadge verdict={a.verdict} /> : null}
                  <span>{a.text}</span>
                </li>
              )
            })
          )}
        </ol>
      </div>
    </section>
  )
}

export default function LiveView({ run }: { run: LiveRun }): React.JSX.Element {
  const state = liveState(run)
  const elapsed = useElapsed(run, state.end?.at ?? null)
  const verdict = state.end?.verdict ?? null
  return (
    <>
      <section className={`ae-card ${verdict === 'malicious' ? 'border-danger!' : ''}`}>
        <div className="ae-card__body flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {verdict ? <VerdictBadge verdict={verdict} /> : <ScanningBadge />}
            <span className="mono selectable min-w-0 truncate text-ink">{run.filename}</span>
            <span className="mono-sm text-ink-subtle">
              {size(run.size)} · {shortHash(run.sha256)}
            </span>
            <span
              className="mono ml-auto text-ink-muted tabular-nums"
              aria-label="Time since it was caught"
            >
              {elapsed}
            </span>
          </div>
          <p className="body-lg m-0 text-ink">
            {state.end
              ? state.end.ok
                ? state.end.summary || `${VERDICT_SENTENCE[verdict ?? 'unknown']}.`
                : state.end.summary
              : 'Held before it reached your Mac. Aegis is opening it in a throwaway sandbox to see what it does.'}
          </p>
          <StageRail state={state} />
        </div>
      </section>

      <div className="ae-live-grid">
        <AgentPane run={run} state={state} />
        <div className={`ae-live-bridge ${state.reaching ? 'is-reaching' : ''}`} aria-hidden="true">
          <span className="ae-live-bridge__line" />
          <span className="ae-live-bridge__label">read-only tools</span>
          <span className="ae-live-bridge__line" />
        </div>
        <SandboxPane state={state} frame={run.frame} />
      </div>

      <p className="mono-sm m-0 text-ink-subtle">
        Your file never runs on this Mac · the sandbox has no network and is deleted when the review
        ends
        {state.end ? (state.end.sandboxDeleted ? ' · deleted' : ' · deletion not confirmed') : ''}
      </p>
    </>
  )
}
