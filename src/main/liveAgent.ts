// The agent half of the live view: who reverse engineers the file once it has been opened in the
// sandbox, and how its steps reach the screen. `LiveAgent` is the seam droidAgent.ts fills with
// the real Droid session (on this Mac, read-only tools into the sandbox, decision 19). Without a
// Factory key or the droid CLI, `scriptedAgent` stands in: its words are scripted, but every tool
// call it makes is one of Droid's real fixed tools (droidLockdown.ts), run inside the real
// sandbox, and its findings come from fixed patterns plus what the sandbox run recorded. It says
// so in the report.

import type { LiveAgentInfo, LiveEventBody } from '@shared/live'
import type {
  CodeExcerpt,
  DroidReport,
  Finding,
  Reason,
  Severity,
  TimelineStep,
  Verdict
} from '@shared/types'
import type { Observation, SampleMeta } from './daytona'
import type { SandboxToolSpec } from './droidLockdown'
import type { FileTypeMatch } from './fileTypes'
import { combine } from './verdict'

export interface AgentContext {
  filename: string
  meta: SampleMeta
  /** What the sample did when it was opened in the sandbox; null if it couldn't run. */
  observation: Observation | null
  tools: SandboxToolSpec[]
  /** The file's type and the reference rows that apply (droidToolkit.ts), when known. */
  match?: FileTypeMatch
  /** Things the agent should report as not known, e.g. the inspector couldn't be set up. */
  notes?: string[]
  /** Runs one fixed tool inside the sandbox and logs it in the sandbox log. */
  runTool(name: string): Promise<{ exitCode: number; output: string }>
  emit(event: Extract<LiveEventBody, { kind: 'agent' }>): void
}

export interface AgentResult {
  report: DroidReport
  /** Reasons for verdict.ts. The agent's own verdict can only raise the result. */
  reasons: Reason[]
  findings: Finding[]
  capabilities: string[]
  code: CodeExcerpt[]
}

export interface LiveAgent {
  info: LiveAgentInfo
  review(ctx: AgentContext): Promise<AgentResult>
}

// ── Patterns the stand-in looks for ─────────────────────────────────────────────────────────────

interface Pattern {
  code: string
  /** Chip, timeline title and finding title. */
  title: string
  /** The short reason text verdict.ts records, lower case. */
  reason: string
  weight: number
  hard?: boolean
  tone: TimelineStep['tone']
  severity: Severity
  capability: string
  /** A source line that shows it. */
  line: RegExp
  /** What the run showed, for the timeline and the agent's words. */
  ran(obs: Observation | null): string
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const PIPE_TO_SHELL = /\|\s*(ba|z)?sh\b/

export const PATTERNS: Pattern[] = [
  {
    code: 'download_and_run',
    title: 'Downloads and runs code from the internet',
    reason: 'downloads a script and runs it',
    weight: 40,
    // Hard rule (architectural.md §4.4 step 7): an installer script that downloads and runs code.
    hard: true,
    tone: 'danger',
    severity: 'critical',
    capability: 'Download and run',
    line: new RegExp(`\\b(curl|wget)\\b[^|]*${PIPE_TO_SHELL.source}`),
    ran: (o) =>
      o?.networkAttempts.length
        ? `In the sandbox it tried; the download was blocked (${count(o.networkAttempts.length, 'network attempt')}), so nothing ran.`
        : 'It did not get that far in the sandbox.'
  },
  {
    code: 'persistence',
    title: 'Sets itself to start at login',
    reason: 'installs a login item (LaunchAgent)',
    weight: 35,
    tone: 'danger',
    severity: 'critical',
    capability: 'Persistence',
    line: /LaunchAgents|LaunchDaemons|crontab\b|\.(bash|zsh)rc\b/,
    ran: (o) => {
      const f = o?.filesWritten.filter((p) => /Launch(Agents|Daemons)|crontab|rc$/.test(p)) ?? []
      return f.length
        ? `In the sandbox it wrote ${f.join(', ')} (inside a scratch folder).`
        : 'The run did not write it.'
    }
  },
  {
    code: 'credential_access',
    title: 'Looks for saved passwords',
    reason: 'reaches for saved passwords and the keychain',
    weight: 35,
    tone: 'danger',
    severity: 'critical',
    capability: 'Credential access',
    line: /Login Data|find-(generic|internet)-password|Keychain|\.ssh\/id_/,
    ran: () => 'Nothing to find in the sandbox: no browser, no keychain.'
  },
  {
    code: 'sends_data',
    title: 'Sends data to a server',
    reason: 'sends data to a remote server',
    weight: 25,
    tone: 'danger',
    severity: 'high',
    capability: 'Data upload',
    line: /--post-data|--data(-binary)?\b|\bcurl\b.*\s-(d|F)\s/,
    ran: (o) =>
      o?.networkAttempts.length
        ? 'The upload was blocked: the sandbox has no network.'
        : 'It did not get that far in the sandbox.'
  },
  {
    code: 'hidden_command',
    title: 'Runs hidden (base64-encoded) commands',
    reason: 'runs base64-encoded commands',
    weight: 25,
    tone: 'warning',
    severity: 'high',
    capability: 'Obfuscation',
    line: new RegExp(`base64\\s+(-d|--decode|-D)\\b[^|]*${PIPE_TO_SHELL.source}`),
    ran: (o) => {
      const decoded = o?.commands.filter((c) => /base64\s+(-d|--decode|-D)/.test(c)).length ?? 0
      return decoded
        ? 'In the sandbox it decoded and ran the hidden command.'
        : 'The run did not reach it.'
    }
  }
]

/** A network attempt the patterns above didn't explain. */
const NETWORK_ONLY: Pattern = {
  code: 'network_attempt',
  title: 'Tries to reach the internet',
  reason: 'tries to reach the internet',
  weight: 15,
  tone: 'warning',
  severity: 'medium',
  capability: 'Network',
  line: /\b(curl|wget|nc|ncat|ssh|scp|ftp|telnet|socat)\b/,
  ran: (o) => `Blocked in the sandbox (${count(o?.networkAttempts.length ?? 0, 'attempt')}).`
}

export interface PatternHit {
  pattern: Pattern
  /** 1-based source lines that show it. */
  lines: number[]
}

/** The patterns in a sample's text, in the order they first appear, plus unexplained network use. */
export function findPatterns(text: string, obs: Observation | null): PatternHit[] {
  const source = text.split('\n')
  const hits: PatternHit[] = []
  for (const pattern of PATTERNS) {
    const lines = source.flatMap((l, i) => (!isComment(l) && pattern.line.test(l) ? [i + 1] : []))
    if (lines.length) hits.push({ pattern, lines })
  }
  const explainsNetwork = hits.some((h) =>
    ['download_and_run', 'sends_data'].includes(h.pattern.code)
  )
  if (!explainsNetwork && obs?.networkAttempts.length) {
    const lines = source.flatMap((l, i) =>
      !isComment(l) && NETWORK_ONLY.line.test(l) ? [i + 1] : []
    )
    hits.push({ pattern: NETWORK_ONLY, lines })
  }
  return hits.sort((a, b) => (a.lines[0] ?? 1e9) - (b.lines[0] ?? 1e9))
}

const isComment = (line: string): boolean => /^\s*#/.test(line)

/** Most source lines shown as code evidence. */
const EXCERPT_LINES = 60

/** Turns pattern hits into everything the report and verdict.ts need. */
export function summarize(
  text: string,
  hits: PatternHit[],
  meta: SampleMeta,
  obs: Observation | null
): Omit<AgentResult, 'report'> & { verdict: Verdict; score: number; summary: string } {
  const source = text.split('\n')
  const at = (n: number): string => source[n - 1]?.trim() ?? ''
  const reasons: Reason[] = hits.map((h) => ({
    code: h.pattern.code,
    text: h.pattern.reason,
    weight: h.pattern.weight,
    hard: h.pattern.hard ?? false
  }))
  const findings: Finding[] = hits.map((h) => ({
    severity: h.pattern.severity,
    title: h.pattern.title,
    detail: h.pattern.ran(obs),
    evidence: h.lines.length
      ? { path: meta.filename, line: h.lines[0], code: at(h.lines[0]) }
      : undefined
  }))
  const confident = obs !== null && !obs.timedOut
  const { verdict, score } = combine(reasons, { confident })
  const flags = hits.flatMap((h) =>
    h.lines
      .filter((n) => n <= EXCERPT_LINES)
      .map((n) => ({ line: n, title: h.pattern.title, severity: h.pattern.severity }))
  )
  const code: CodeExcerpt[] = text.trim()
    ? [
        {
          path: meta.filename,
          origin: 'read inside the sandbox',
          startLine: 1,
          lines: source.slice(0, EXCERPT_LINES),
          flags
        }
      ]
    : []
  const titles = hits.map((h) => h.pattern.title.toLowerCase())
  const summary = hits.length
    ? `It ${list(titles)}.`
    : obs
      ? `It ran in the sandbox${obs.stdout.trim() ? ', printed a message' : ''}, wrote ${count(obs.filesWritten.length, 'file')} and tried no network.`
      : 'It could not be run in the sandbox, and nothing in it matched a known pattern.'
  return {
    verdict,
    score,
    summary,
    reasons,
    findings,
    capabilities: [...new Set(hits.map((h) => h.pattern.capability))],
    code
  }
}

const list = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** The first few lines of a tool's output, for the live view. */
export function excerpt(output: string, lines = 4, chars = 320): string {
  const head = output.split('\n').slice(0, lines).join('\n')
  return head.length > chars ? `${head.slice(0, chars)}…` : head
}

// ── The stand-in ─────────────────────────────────────────────────────────────────────────────────

const STAND_IN_NOTE =
  'Reviewed by a scripted stand-in for Droid: it matches fixed patterns and what the sandbox run recorded; it does not reason about the code.'

/**
 * The scripted stand-in for Droid. `paceMs` spaces its steps out so a person can follow them on
 * screen; tests pass 0.
 */
export function scriptedAgent({ paceMs = 900 }: { paceMs?: number } = {}): LiveAgent {
  const pause = (ms = paceMs): Promise<void> =>
    ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
  return {
    info: { name: 'Droid', mode: 'scripted', where: 'mac' },
    async review(ctx) {
      const say = async (text: string): Promise<void> => {
        ctx.emit({ kind: 'agent', step: 'thought', text })
        await pause()
      }
      const call = async (name: string): Promise<{ exitCode: number; output: string }> => {
        const spec = ctx.tools.find((t) => t.name === name)
        if (!spec) throw new Error(`no tool named ${name}`)
        ctx.emit({
          kind: 'agent',
          step: 'tool',
          tool: name,
          command: spec.command,
          text: spec.description
        })
        const started = Date.now()
        const res = await ctx.runTool(name)
        // A fixed tool answers in ~0.1 s; keep the call on screen long enough to follow.
        await pause(Math.max(0, paceMs * 0.8 - (Date.now() - started)))
        ctx.emit({
          kind: 'agent',
          step: 'result',
          tool: name,
          exitCode: res.exitCode,
          bytes: Buffer.byteLength(res.output),
          text: excerpt(res.output)
        })
        await pause(paceMs / 2)
        return res
      }

      await say(
        `I'm running on this Mac. ${ctx.filename} is in a Daytona sandbox with no network, and I can only reach it through ${count(ctx.tools.length, 'read-only tool')}.`
      )
      await say('First, what is in the sample folder.')
      await call('list_sample_files')
      await say('Its size and fingerprint, to be sure it is the file that was downloaded.')
      const described = await call('describe_sample')
      await say(
        described.output.includes(ctx.meta.sha256)
          ? 'The SHA-256 matches the download.'
          : 'The SHA-256 does not match the download, so I treat what I read with care.'
      )
      await say('Now the file itself.')
      const read = await call('read_sample')
      const text = read.exitCode === 0 ? read.output : ''

      const obs = ctx.observation
      if (obs) {
        await say(
          `When it was opened it ran ${count(obs.commands.length, 'command')}, wrote ${count(obs.filesWritten.length, 'file')} and made ${count(obs.networkAttempts.length, 'network attempt')}${obs.networkAttempts.length ? ', all blocked' : ''}.`
        )
      }
      const hits = findPatterns(text, obs)
      for (const h of hits) {
        const where = h.lines.length ? `Line ${h.lines[0]}` : 'The run'
        await say(`${where}: ${h.pattern.title.toLowerCase()}. ${h.pattern.ran(obs)}`)
      }
      if (!hits.length) {
        await say(
          'Nothing in the file or the run reaches for the network, your files or login items.'
        )
      }

      const s = summarize(text, hits, ctx.meta, obs)
      ctx.emit({ kind: 'agent', step: 'verdict', verdict: s.verdict, text: s.summary })
      const timeline: TimelineStep[] = hits.map((h, i) => ({
        step: i + 1,
        tone: h.pattern.tone,
        title: h.pattern.title,
        detail: h.pattern.ran(obs),
        evidence: h.lines.slice(0, 3).map((n) => ({
          path: ctx.meta.filename,
          line: n,
          code: text.split('\n')[n - 1]?.trim() ?? ''
        }))
      }))
      return {
        report: {
          timeline,
          verdict: s.verdict,
          summary: s.summary,
          confidence: obs && !obs.timedOut ? 'medium' : 'low',
          unknowns: [STAND_IN_NOTE],
          reviewer: 'scripted'
        },
        reasons: s.reasons,
        findings: s.findings,
        capabilities: s.capabilities,
        code: s.code
      }
    }
  }
}
