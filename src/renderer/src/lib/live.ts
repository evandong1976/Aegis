// The live view's data: a run fetched once, then every event the main process pushes for it
// (src/shared/live.ts). `liveState` folds the events into what LiveView draws.

import { useEffect, useState } from 'react'
import {
  LIVE_STAGES,
  type LiveEvent,
  type LiveEventBody,
  type LiveRun,
  type LiveStage
} from '@shared/live'

/** The run for a scan, kept current; null when there is none (or it was forgotten). */
export function useLiveRun(scanId: string | undefined): LiveRun | null | undefined {
  // Keyed by scan, so switching scans never shows the previous scan's run.
  const [held, setHeld] = useState<{ scanId: string; run: LiveRun | null } | null>(null)
  useEffect(() => {
    if (!scanId) return
    let alive = true
    // Events that arrive before the first fetch answers are applied on top of it.
    const early: LiveEvent[] = []
    let loaded = false
    void window.aegis.invoke('live:get', scanId).then((r) => {
      if (!alive) return
      loaded = true
      setHeld({ scanId, run: r ? early.reduce(apply, r) : null })
    })
    const off = window.aegis.on('live:event', ({ scanId: id, event }) => {
      if (id !== scanId) return
      if (!loaded) early.push(event)
      else
        setHeld((h) => (h?.scanId === id && h.run ? { scanId: id, run: apply(h.run, event) } : h))
    })
    return () => {
      alive = false
      off()
    }
  }, [scanId])
  if (!scanId) return null
  return held?.scanId === scanId ? held.run : undefined
}

function apply(run: LiveRun, event: LiveEvent): LiveRun {
  if (event.kind === 'frame') {
    return run.frame && run.frame.seq >= event.seq ? run : { ...run, frame: event }
  }
  if (run.events.some((e) => e.seq === event.seq)) return run
  return {
    ...run,
    events: [...run.events, event],
    finished: run.finished || event.kind === 'end'
  }
}

type Of<K extends LiveEventBody['kind']> = LiveEvent & Extract<LiveEventBody, { kind: K }>

export type StageState = 'pending' | 'active' | 'done' | 'failed'

export interface LiveState {
  stages: Record<LiveStage, { state: StageState; detail: string | null }>
  sandbox: Of<'sandbox'> | null
  desktop: Of<'desktop'> | null
  term: Array<Of<'term'>>
  agent: Array<Of<'agent'>>
  end: Of<'end'> | null
  /** True while the agent has called a tool and its result hasn't come back. */
  reaching: boolean
}

export function liveState(run: LiveRun): LiveState {
  const stages = Object.fromEntries(
    LIVE_STAGES.map((s) => [s, { state: 'pending' as StageState, detail: null as string | null }])
  ) as LiveState['stages']
  const s: LiveState = {
    stages,
    sandbox: null,
    desktop: null,
    term: [],
    agent: [],
    end: null,
    reaching: false
  }
  for (const e of run.events) {
    if (e.kind === 'stage') stages[e.stage] = { state: e.state, detail: e.detail }
    else if (e.kind === 'sandbox') s.sandbox = e
    else if (e.kind === 'desktop') s.desktop = e
    else if (e.kind === 'term') s.term.push(e)
    else if (e.kind === 'agent') {
      s.agent.push(e)
      if (e.step === 'tool') s.reaching = true
      if (e.step === 'result' || e.step === 'verdict') s.reaching = false
    } else if (e.kind === 'end') s.end = e
  }
  return s
}
