// The live view's event stream (feature/visualization): what happens to a caught file while
// Aegis opens it in a sandbox and the agent reverse engineers it. The main process emits these
// (src/main/sandboxScan.ts today; workerA.ts drives the agent events at milestone 4) and the
// renderer draws them (views/main/LiveView.tsx). Change only together and note it in the Handoff.

import type { Verdict } from './types'

/** The stages the live view draws, in order. */
export const LIVE_STAGES = ['caught', 'sandbox', 'opened', 'agent', 'verdict'] as const
export type LiveStage = (typeof LIVE_STAGES)[number]

/** Who a terminal line came from: Aegis setting up, the sample running, or the agent's tools. */
export type TermSource = 'aegis' | 'sample' | 'agent'

/**
 * cmd: a command run inside the sandbox. out / err: its output. note: Aegis explaining a step.
 * blocked: a network attempt the sandbox refused. file: a file the sample wrote.
 */
export type TermStream = 'cmd' | 'out' | 'err' | 'note' | 'blocked' | 'file'

/** Fields every event carries; the main process stamps them. */
export interface LiveEventBase {
  /** 1, 2, 3… per run, so the renderer can drop duplicates. */
  seq: number
  at: string
}

export type LiveEventBody =
  | {
      kind: 'stage'
      stage: LiveStage
      state: 'active' | 'done' | 'failed'
      /** One plain-English line shown under the stage. */
      detail: string
    }
  | {
      kind: 'sandbox'
      provider: 'daytona' | 'docker'
      sandboxId: string
      network: 'off'
      startupMs: number
    }
  | {
      kind: 'desktop'
      state: 'starting' | 'on' | 'off'
      detail: string
    }
  | {
      /** A picture of the sandbox's desktop. Only the latest is kept. */
      kind: 'frame'
      /** Base64 JPEG, shown as a data URL (the renderer loads no remote content). */
      jpeg: string
    }
  | { kind: 'term'; source: TermSource; stream: TermStream; text: string }
  | {
      kind: 'agent'
      /** thought: what the agent says it is doing. tool / result: a call into the sandbox. */
      step: 'thought' | 'tool' | 'result' | 'verdict'
      text: string
      tool?: string
      command?: string
      exitCode?: number
      bytes?: number
      verdict?: Verdict
    }
  | {
      kind: 'end'
      ok: boolean
      verdict: Verdict | null
      summary: string
      sandboxDeleted: boolean
    }

export type LiveEvent = LiveEventBase & LiveEventBody

/** Which agent drives the agent events, and where it runs. */
export interface LiveAgentInfo {
  name: string
  /** `scripted` until workerA.ts runs the real Droid session (milestone 4). */
  mode: 'scripted' | 'droid'
  /** Droid runs on this Mac and reaches into the sandbox through read-only tools (decision 19). */
  where: 'mac' | 'sandbox'
}

/** Everything the live view needs for one run. */
export interface LiveRun {
  scanId: string
  filename: string
  size: number
  sha256: string | null
  startedAt: string
  agent: LiveAgentInfo
  /** Every event except frames, in order. */
  events: LiveEvent[]
  /** The latest desktop frame, if the desktop is on. */
  frame: (LiveEventBase & Extract<LiveEventBody, { kind: 'frame' }>) | null
  finished: boolean
}

/** Harmless test files the app can send through the sandbox before downloads are intercepted. */
export const LIVE_SAMPLES = {
  'fake-installer': {
    filename: 'zoom-update.sh',
    label: 'Fake Zoom installer',
    detail:
      'Looks malicious: download-and-run, a LaunchAgent, password lookups. All fake or blocked.'
  },
  'terminal-demo': {
    filename: 'aegis-terminal-demo.command',
    label: 'Terminal demo',
    detail: 'demo/aegis-terminal-demo.command: prints a labelled message and exits.'
  }
} as const
export type LiveSampleKey = keyof typeof LIVE_SAMPLES
