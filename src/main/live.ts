// The live view's event bus (src/shared/live.ts): keeps each run's events in memory, stamps them,
// and pushes each one to the open windows. Frames replace each other, so a long run doesn't pile up
// pictures. Only the last few runs are kept; reports in SQLite outlive them.

import type { LiveAgentInfo, LiveEvent, LiveEventBody, LiveRun } from '@shared/live'

/** Runs kept in memory for the live view; older ones are forgotten (their reports stay). */
export const LIVE_RUNS_KEPT = 5

export class LiveBus {
  private runs = new Map<string, LiveRun>()
  private readonly push: (scanId: string, event: LiveEvent) => void

  // No parameter property, to match the rest of src/main.
  constructor(push: (scanId: string, event: LiveEvent) => void) {
    this.push = push
  }

  begin(run: {
    scanId: string
    filename: string
    size: number
    sha256: string | null
    agent: LiveAgentInfo
  }): void {
    this.runs.set(run.scanId, {
      ...run,
      startedAt: new Date().toISOString(),
      events: [],
      frame: null,
      finished: false
    })
    while (this.runs.size > LIVE_RUNS_KEPT) {
      const oldest = this.runs.keys().next().value as string
      this.runs.delete(oldest)
    }
  }

  emit(scanId: string, body: LiveEventBody): void {
    const run = this.runs.get(scanId)
    if (!run) return
    const event = { ...body, seq: nextSeq(run), at: new Date().toISOString() } as LiveEvent
    if (event.kind === 'frame') run.frame = event
    else run.events.push(event)
    if (event.kind === 'end') run.finished = true
    this.push(scanId, event)
  }

  get(scanId: string): LiveRun | null {
    return this.runs.get(scanId) ?? null
  }
}

function nextSeq(run: LiveRun): number {
  const last = run.events[run.events.length - 1]?.seq ?? 0
  return Math.max(last, run.frame?.seq ?? 0) + 1
}

/**
 * Turns chunks of a growing file into whole lines: `push` returns the complete lines so far and
 * keeps a trailing partial line for the next chunk; `flush` returns whatever is left.
 */
export class LineSplitter {
  private rest = ''

  push(chunk: string): string[] {
    const text = this.rest + chunk
    const lines = text.split('\n')
    this.rest = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    const last = this.rest
    this.rest = ''
    return last ? [last] : []
  }
}
