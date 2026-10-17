// A caught file, opened in a real network-off Daytona sandbox, while the live view watches
// (feature/visualization). The steps are daytona.ts's: create with the network off at creation,
// upload with a SHA-256 check, prove the network is off, run the file under `sh -x` with a time
// limit, delete in a `finally`. This adds what the live view needs on top:
//
// - every step as a live event (src/shared/live.ts), and the scan in SQLite from the first moment,
//   so the Report shows it while it runs and after;
// - the sandbox's desktop (Daytona Computer Use: Xvfb + xfce4), with the file opened in a terminal
//   window there and a picture sent every second. Optional: no desktop, no pictures, same verdict;
// - the `sh -x` trace streamed while the file runs, by reading its output files from the side;
// - the agent (liveAgent.ts) reverse engineering it through read-only tools.
//
// Milestone 3's `/download` route calls `startSandboxScan` with the intercepted bytes; until then
// the app's "Test the sandbox" button sends a built-in harmless sample (testSamples.ts).
// Nothing here runs a sample on this Mac.

import { randomUUID } from 'node:crypto'
import type { LiveEventBody, LiveStage, TermSource, TermStream } from '@shared/live'
import type { CheckRun, ScanAction, ScanReport, ScanSource, Verdict } from '@shared/types'
import {
  NETWORK_TOOLS,
  PROBE_URLS,
  RUN_DIR,
  RUN_TIMEOUT_S,
  SAMPLE_PATH,
  runSample,
  sha256Hex,
  withSandbox,
  type Observation,
  type SampleMeta,
  type SandboxClient,
  type SandboxLogEntry,
  type SandboxSession
} from './daytona'
import { sandboxToolSpecs } from './droidLockdown'
import { LineSplitter, type LiveBus } from './live'
import type { AgentResult, LiveAgent } from './liveAgent'
import { applyAiSuggestion, combine } from './verdict'

/** The parts of Daytona's Computer Use this module uses (structural, so tests can fake it). */
export interface DesktopLike {
  computerUse: {
    start(): Promise<unknown>
    screenshot: {
      takeCompressed(opts: {
        format?: string
        quality?: number
        scale?: number
        showCursor?: boolean
      }): Promise<{ screenshot?: string }>
    }
  }
}

export interface SandboxScanInput {
  bytes: Buffer
  filename: string
  url: string | null
  referrer: string | null
  contentType: string | null
  source: ScanSource
  /** Where it was caught, for people: "Chrome", "Sandbox test". */
  seenIn: string
}

export interface SandboxScanDeps {
  client: () => Promise<SandboxClient>
  bus: LiveBus
  agent: LiveAgent
  putScan(report: ScanReport): void
  log(level: 'block' | 'warn' | 'allow' | null, text: string): void
  /** Called with +1 when a scan starts and -1 when it ends. */
  active(delta: 1 | -1): void
  snapshot?: string
  /** How often a desktop picture is taken. */
  frameEveryMs?: number
  /** How often the running file's output is read. */
  traceEveryMs?: number
  /** How long the desktop gets to start before the run goes on without it. */
  desktopStartS?: number
  /**
   * With the desktop on, how long the finished run stays on screen before the review starts, so a
   * picture shows the window with the file's output (a fast file finishes within a second).
   */
  desktopDwellMs?: number
}

const DESKTOP_START_S = 25
const FRAME_EVERY_MS = 1000
const TRACE_EVERY_MS = 700
const DESKTOP_DWELL_MS = 2000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
const shortId = (id: string): string => id.slice(0, 8)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Plain-English file kind from the name. */
export function fileKind(name: string): string {
  if (/\.(command|sh|bash|zsh|tool)$/i.test(name)) return 'Shell script'
  if (/\.pkg$/i.test(name)) return 'Installer'
  if (/\.(dmg|iso)$/i.test(name)) return 'Disc image'
  if (/\.(zip|tar|gz|tgz|7z)$/i.test(name)) return 'Archive'
  return 'File'
}

/** What a scan does with the file once it has a verdict. A test run delivers nothing. */
function actionFor(verdict: Verdict): ScanAction {
  if (verdict === 'malicious') return 'quarantined'
  if (verdict === 'clean') return 'allowed'
  return 'held'
}

/**
 * Starts a sandbox scan and returns its ID at once; the scan is already in SQLite and on the live
 * bus. `done` settles with the final report and never rejects: a failure becomes an Unknown report.
 */
export function startSandboxScan(
  deps: SandboxScanDeps,
  input: SandboxScanInput
): { scanId: string; done: Promise<ScanReport> } {
  const scanId = randomUUID()
  const now = new Date().toISOString()
  const sha256 = sha256Hex(input.bytes)
  const kind = fileKind(input.filename)
  const base: ScanReport = {
    id: scanId,
    kind: 'download',
    source: input.source,
    seenIn: input.seenIn,
    url: input.url,
    filename: input.filename,
    fileKind: kind,
    size: input.bytes.length,
    status: 'received',
    verdict: null,
    score: null,
    reason: null,
    action: 'scanning',
    durationMs: null,
    createdAt: now,
    updatedAt: now,
    summary: null,
    reasons: [],
    stage1: null,
    droid: null,
    indicators: {
      sha256,
      realType: kind,
      claimedType: input.filename.includes('.') ? `.${input.filename.split('.').pop()}` : null,
      signature: null,
      size: input.bytes.length,
      firstSeen: now
    },
    code: [],
    checks: [],
    sandbox: [],
    partial: false,
    heldPath: null
  }
  deps.bus.begin({
    scanId,
    filename: input.filename,
    size: input.bytes.length,
    sha256,
    agent: deps.agent.info
  })
  deps.putScan(base)
  deps.active(1)
  deps.log('warn', `sandbox scan id=${shortId(scanId)} file=${input.filename} held`)
  const done = run(deps, input, base).finally(() => deps.active(-1))
  return { scanId, done }
}

interface RunResult {
  meta: SampleMeta
  observation: Observation
  agent: AgentResult
  desktop: boolean
  sandboxId: string
  startupMs: number
}

async function run(
  deps: SandboxScanDeps,
  input: SandboxScanInput,
  base: ScanReport
): Promise<ScanReport> {
  const t0 = Date.now()
  const scanId = base.id
  const emit = (body: LiveEventBody): void => deps.bus.emit(scanId, body)
  const term = (source: TermSource, stream: TermStream, text: string): void =>
    emit({ kind: 'term', source, stream, text })
  let stage: LiveStage = 'caught'
  const enter = (next: LiveStage, detail: string): void => {
    stage = next
    emit({ kind: 'stage', stage: next, state: 'active', detail })
  }
  const finish = (s: LiveStage, detail: string): void =>
    emit({ kind: 'stage', stage: s, state: 'done', detail })

  finish(
    'caught',
    `Held before it reached your Mac · ${count(input.bytes.length, 'byte')} · SHA-256 ${base.indicators.sha256?.slice(0, 12)}…`
  )
  enter('sandbox', 'Starting a fresh Daytona sandbox with the network off')
  deps.putScan({ ...base, status: 'prechecked', updatedAt: new Date().toISOString() })
  term('aegis', 'cmd', 'daytona create --network-block-all --ephemeral')

  let outcome: Awaited<ReturnType<typeof withSandbox<RunResult>>>
  try {
    const client = await deps.client()
    outcome = await withSandbox(
      client,
      { labels: { job: 'scan', scan: shortId(scanId) }, snapshot: deps.snapshot },
      (session) => inSandbox(deps, input, session, { emit, term, enter, finish })
    )
  } catch (err) {
    outcome = { error: message(err), log: [], deleted: true }
  }

  const sandboxId = outcome.result?.sandboxId ?? outcome.log[0]?.detail.split(' ')[0] ?? null
  if (outcome.log.length) {
    term('aegis', 'cmd', 'daytona delete')
    term(
      'aegis',
      outcome.deleted ? 'note' : 'err',
      outcome.deleted
        ? `sandbox ${sandboxId ? shortId(sandboxId) : ''} deleted`
        : 'could not confirm the sandbox was deleted; check the Daytona dashboard'
    )
  }

  const report = outcome.result
    ? finishedReport(base, outcome.result, outcome.log, outcome.deleted, deps, t0)
    : failedReport(base, outcome.error ?? 'unknown error', outcome.log, outcome.deleted, deps, t0)

  if (outcome.result) {
    finish('verdict', report.summary ?? '')
    deps.log(
      report.verdict === 'clean' ? 'allow' : 'block',
      `sandbox scan id=${shortId(scanId)} verdict=${report.verdict} score=${report.score} ms=${report.durationMs}`
    )
  } else {
    emit({ kind: 'stage', stage, state: 'failed', detail: outcome.error ?? 'failed' })
    deps.log('warn', `sandbox scan id=${shortId(scanId)} failed error=${outcome.error}`)
  }
  deps.putScan(report)
  emit({
    kind: 'end',
    ok: Boolean(outcome.result),
    verdict: report.verdict,
    summary: report.summary ?? '',
    sandboxDeleted: outcome.deleted
  })
  return report
}

interface Emitters {
  emit: (body: LiveEventBody) => void
  term: (source: TermSource, stream: TermStream, text: string) => void
  enter: (stage: LiveStage, detail: string) => void
  finish: (stage: LiveStage, detail: string) => void
}

async function inSandbox(
  deps: SandboxScanDeps,
  input: SandboxScanInput,
  session: SandboxSession,
  { emit, term, enter, finish }: Emitters
): Promise<RunResult> {
  const startupMs = session.log[0]?.ms ?? 0
  emit({ kind: 'sandbox', provider: 'daytona', sandboxId: session.id, network: 'off', startupMs })
  term(
    'aegis',
    'note',
    `sandbox ${shortId(session.id)} ready in ${seconds(startupMs)} · network off at creation`
  )

  term('aegis', 'cmd', `upload ${input.filename} → ~/${SAMPLE_PATH}`)
  const meta = await session.upload(input.bytes, {
    filename: input.filename,
    url: input.url,
    referrer: input.referrer,
    contentType: input.contentType
  })
  term('aegis', 'cmd', `sha256sum ${SAMPLE_PATH}`)
  term('aegis', 'out', `${meta.sha256}  ${SAMPLE_PATH}`)
  term('aegis', 'note', 'matches the download')

  const hosts = PROBE_URLS.map((u) => new URL(u).host)
  term('aegis', 'cmd', `probe ${hosts.join(', ')} with curl, wget and python3`)
  if (!(await session.networkIsOff())) {
    throw new Error('the sandbox could reach the network, so Aegis did not open the file')
  }
  term('aegis', 'blocked', `all ${hosts.length * 3} attempts blocked: no network`)
  finish('sandbox', `Sandbox ${shortId(session.id)} · network off, checked`)

  // Starting the desktop is part of opening the file the way a Mac would (in a window).
  enter('opened', `Opening ${input.filename} the way your Mac would, inside the sandbox`)
  const desktop = await startDesktop(session, emit, deps)
  try {
    if (desktop) await openOnDesktop(session, input.filename)
    term(
      'sample',
      'note',
      `sh -x ${input.filename}  (limit ${RUN_TIMEOUT_S} s, scratch home, empty environment)`
    )
    const trace = streamTrace(session, term, deps.traceEveryMs ?? TRACE_EVERY_MS)
    let observation: Observation
    try {
      observation = await runSample(session)
    } finally {
      await trace.stop()
    }
    if (trace.commands() === 0) {
      // The side reads saw nothing (or failed): show the recorded trace instead.
      for (const c of observation.commands)
        term('sample', NETWORK_TOOLS.test(c) ? 'blocked' : 'cmd', c)
      for (const l of observation.stdout.split('\n').filter(Boolean)) term('sample', 'out', l)
    }
    for (const f of observation.filesWritten) term('sample', 'file', f)
    const ran =
      `exit ${observation.exitCode}${observation.timedOut ? ' (ran out of time)' : ''} · ` +
      `${count(observation.commands.length, 'command')} · ${count(observation.filesWritten.length, 'file')} written · ` +
      `${count(observation.networkAttempts.length, 'network attempt')}${observation.networkAttempts.length ? ', all blocked' : ''}`
    term('sample', 'note', ran)
    if (desktop) await sleep(deps.desktopDwellMs ?? DESKTOP_DWELL_MS)
    finish('opened', ran)

    enter(
      'agent',
      deps.agent.info.mode === 'scripted'
        ? 'Reverse engineering it through read-only tools (scripted stand-in for Droid)'
        : `${deps.agent.info.name} is reverse engineering it from this Mac, through read-only tools`
    )
    const tools = sandboxToolSpecs(SAMPLE_PATH)
    const agent = await deps.agent.review({
      filename: input.filename,
      meta,
      observation,
      tools,
      runTool: async (name) => {
        const spec = tools.find((t) => t.name === name)
        if (!spec) throw new Error(`no tool named ${name}`)
        term('agent', 'cmd', spec.command)
        const res = await session.exec(`agent tool ${name}`, spec.command, 15)
        for (const line of res.result.split('\n').slice(0, 3)) if (line) term('agent', 'out', line)
        return { exitCode: res.exitCode, output: res.result }
      },
      emit
    })
    finish('agent', agent.report.summary)
    return { meta, observation, agent, desktop: desktop !== null, sandboxId: session.id, startupMs }
  } finally {
    await desktop?.stop()
  }
}

// ── The desktop ─────────────────────────────────────────────────────────────────────────────────

async function startDesktop(
  session: SandboxSession,
  emit: (body: LiveEventBody) => void,
  deps: SandboxScanDeps
): Promise<{ stop(): Promise<void> } | null> {
  const cu = (session.sandbox as Partial<DesktopLike>).computerUse
  if (!cu) {
    emit({ kind: 'desktop', state: 'off', detail: 'This sandbox has no desktop.' })
    return null
  }
  emit({ kind: 'desktop', state: 'starting', detail: 'Starting the sandbox desktop' })
  const started = performance.now()
  const limit = (deps.desktopStartS ?? DESKTOP_START_S) * 1000
  try {
    await Promise.race([
      cu.start(),
      sleep(limit).then(() => {
        throw new Error(`no desktop after ${seconds(limit)}`)
      })
    ])
    session.record({ step: 'desktop start', ok: true, detail: 'Xvfb + xfce4 + VNC', started })
  } catch (err) {
    session.record({ step: 'desktop start', ok: false, detail: message(err), started })
    emit({ kind: 'desktop', state: 'off', detail: `The desktop didn't start (${message(err)}).` })
    return null
  }
  emit({
    kind: 'desktop',
    state: 'on',
    detail: `Desktop ready in ${seconds(performance.now() - started)}`
  })
  let stopped = false
  const grab = async (): Promise<void> => {
    const shot = await cu.screenshot.takeCompressed({ format: 'jpeg', quality: 60, scale: 0.6 })
    if (shot.screenshot) emit({ kind: 'frame', jpeg: shot.screenshot })
  }
  const every = deps.frameEveryMs ?? FRAME_EVERY_MS
  const loop = (async () => {
    while (!stopped) {
      await grab().catch(() => undefined)
      if (!stopped) await sleep(every)
    }
  })()
  return {
    async stop() {
      stopped = true
      await loop
      await grab().catch(() => undefined)
    }
  }
}

/** A window title the sandbox's shell can't misread. */
const safeTitle = (name: string): string => name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 60)

/**
 * The xfce4-terminal command that shows the run on the sandbox desktop the way Finder shows a
 * .command file: a terminal window titled with the file's name. It shows the very run that is
 * being recorded (its output and `sh -x` trace, from RUN_DIR/out), not a second run. Arguments are
 * spelled out because the sandbox's shell doesn't word-split variables; `--disable-server` because
 * there is no D-Bus session; `setsid -f` so it outlives the command (logs/…-desktop-probe/).
 */
export function desktopOpenCommand(filename: string): string {
  const out = `${RUN_DIR}/out`
  const view =
    `until [ -f ${out}/marker ]; do sleep 0.2; done; ` +
    `tail -q -n +1 -F ${out}/stdout ${out}/stderr 2>/dev/null`
  return (
    `DISPLAY=:0 setsid -f xfce4-terminal --disable-server --hold ` +
    `--title='${safeTitle(filename)}' -x sh -c '${view}' >/dev/null 2>&1 </dev/null`
  )
}

async function openOnDesktop(session: SandboxSession, filename: string): Promise<void> {
  await session.exec('open on desktop', desktopOpenCommand(filename), 15).catch(() => undefined)
}

// ── Streaming the trace while the file runs ────────────────────────────────────────────────────

/**
 * Reads the running file's stderr (`sh -x` trace) and stdout from the side, every `everyMs`,
 * base64-encoded so no byte is lost, and turns new lines into terminal events. The two files are
 * read one after the other, so their order on screen is approximate. Reads that fail are skipped:
 * the recorded observation is the evidence, this is only the live picture.
 */
function streamTrace(
  session: SandboxSession,
  term: (source: TermSource, stream: TermStream, text: string) => void,
  everyMs: number
): { stop(): Promise<void>; commands(): number } {
  const files = ['stderr', 'stdout'] as const
  const offset = { stderr: 0, stdout: 0 }
  const split = { stderr: new LineSplitter(), stdout: new LineSplitter() }
  let commands = 0
  const line = (file: (typeof files)[number], text: string): void => {
    if (file === 'stdout') return term('sample', 'out', text)
    if (/^\++ /.test(text)) {
      const cmd = text.replace(/^\++ /, '')
      commands++
      return term('sample', NETWORK_TOOLS.test(cmd) ? 'blocked' : 'cmd', cmd)
    }
    if (text.trim()) term('sample', 'err', text)
  }
  const read = async (): Promise<void> => {
    for (const f of files) {
      const res = await session.sandbox.process.executeCommand(
        `tail -c +${offset[f] + 1} ${RUN_DIR}/out/${f} 2>/dev/null | base64 -w0`,
        undefined,
        undefined,
        10
      )
      const chunk = Buffer.from((res.result ?? '').trim(), 'base64')
      offset[f] += chunk.length
      for (const l of split[f].push(chunk.toString('utf8'))) line(f, l)
    }
  }
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      await sleep(everyMs)
      if (!stopped) await read().catch(() => undefined)
    }
  })()
  return {
    async stop() {
      stopped = true
      await loop
      await read().catch(() => undefined)
      for (const f of files) for (const l of split[f].flush()) line(f, l)
    },
    commands: () => commands
  }
}

// ── Reports ─────────────────────────────────────────────────────────────────────────────────────

function sandboxRecord(
  sandboxId: string | null,
  log: SandboxLogEntry[],
  deleted: boolean,
  snapshot: string | undefined
): ScanReport['sandbox'] {
  if (!sandboxId) return []
  const create = log.find((e) => e.step === 'create')
  const runStep = log.find((e) => e.step === 'run sample')
  return [
    {
      provider: 'daytona',
      sandboxId,
      image: snapshot ?? 'Daytona default snapshot',
      network: 'off',
      startupMs: create?.ms ?? 0,
      runMs: runStep?.ms ?? 0,
      ran: log.map((e) => e.step),
      destroyedAt: deleted ? new Date().toISOString() : null
    }
  ]
}

function finishedReport(
  base: ScanReport,
  r: RunResult,
  log: SandboxLogEntry[],
  deleted: boolean,
  deps: SandboxScanDeps,
  t0: number
): ScanReport {
  const obs = r.observation
  const rules = combine(r.agent.reasons, { confident: !obs.timedOut })
  const final = applyAiSuggestion(rules, r.agent.report.verdict)
  const top = [...final.reasons].sort((a, b) => b.weight - a.weight)[0]
  const checks: CheckRun[] = [
    { name: 'Sandbox, network off at creation', state: 'ok', result: seconds(r.startupMs) },
    { name: 'Upload SHA-256 check', state: 'ok', result: 'matched' },
    { name: 'Network probe', state: 'ok', result: 'all blocked' },
    {
      name: 'Sandbox desktop',
      state: r.desktop ? 'ok' : 'skipped',
      result: r.desktop ? 'on' : 'not available'
    },
    {
      name: 'Opened the file',
      state: obs.timedOut ? 'warn' : 'ok',
      result: obs.timedOut ? 'ran out of time' : `exit ${obs.exitCode}`
    },
    {
      name: 'Agent review',
      state: r.agent.report.reviewer === 'scripted' ? 'warn' : 'ok',
      result: r.agent.report.reviewer === 'scripted' ? 'scripted stand-in' : 'Droid'
    },
    {
      name: 'Sandbox deleted',
      state: deleted ? 'ok' : 'fail',
      result: deleted ? 'yes' : 'unconfirmed'
    }
  ]
  const now = new Date().toISOString()
  return {
    ...base,
    status: 'done',
    verdict: final.verdict,
    score: final.score,
    reason: top ? top.text[0].toUpperCase() + top.text.slice(1) : null,
    action: actionFor(final.verdict),
    durationMs: Date.now() - t0,
    updatedAt: now,
    summary: r.agent.report.summary,
    reasons: final.reasons,
    stage1: {
      file: {
        name: base.filename ?? r.meta.filename,
        realType: base.fileKind ?? 'File',
        sha256: r.meta.sha256,
        size: r.meta.size
      },
      findings: r.agent.findings,
      iocs: obs.networkAttempts,
      capabilities: r.agent.capabilities,
      score: final.score,
      partial: obs.timedOut
    },
    droid: r.agent.report,
    code: r.agent.code,
    checks,
    sandbox: sandboxRecord(r.sandboxId, log, deleted, deps.snapshot),
    partial: obs.timedOut
  }
}

function failedReport(
  base: ScanReport,
  error: string,
  log: SandboxLogEntry[],
  deleted: boolean,
  deps: SandboxScanDeps,
  t0: number
): ScanReport {
  const sandboxId = log.find((e) => e.step === 'create')?.detail.split(' ')[0] ?? null
  return {
    ...base,
    status: 'failed',
    // Missing evidence is never Clean (decision 1).
    verdict: 'unknown',
    score: null,
    reason: "Couldn't open it in a sandbox",
    action: 'held',
    durationMs: Date.now() - t0,
    updatedAt: new Date().toISOString(),
    summary: `Aegis couldn't open it in a sandbox: ${error}`,
    checks: log.map((e) => ({
      name: e.step,
      state: e.ok ? 'ok' : 'fail',
      result: e.ok ? seconds(e.ms) : 'failed'
    })),
    sandbox: sandboxRecord(sandboxId, log, deleted, deps.snapshot),
    partial: true
  }
}
