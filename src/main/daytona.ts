// Daytona sandboxes for analysis (MEGA_PROMPT §5.3, architectural.md §3.6). One way to make a
// sandbox: network off **at creation** (this account's tier refuses changing it later, PLAN.md ›
// Sponsor findings › Daytona), ephemeral, a 20 s start limit with one retry, and always deleted in
// a `finally`. Every step is written to a sandbox log, which becomes Worker A's log in the report.
//
// Nothing here runs a sample on this Mac: `runSample` runs it inside the sandbox only.
//
// No `@shared` imports here: scripts/try-sandbox.mts runs this file directly under Node.

import { createHash } from 'node:crypto'

/** The parts of a Daytona sandbox this module uses (structural, so tests can pass a fake). */
export interface SandboxLike {
  id: string
  networkBlockAll?: boolean
  fs: {
    createFolder(path: string, mode: string): Promise<void>
    uploadFile(file: Buffer, remotePath: string, timeout?: number): Promise<void>
  }
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number
    ): Promise<{ exitCode: number; result: string }>
  }
  delete(timeout?: number): Promise<void>
}

export interface CreateParams {
  snapshot?: string
  networkBlockAll: true
  ephemeral: true
  autoStopInterval: number
  labels: Record<string, string>
}

/** The part of `new Daytona()` this module uses. */
export interface SandboxClient {
  create(params: CreateParams, options: { timeout: number }): Promise<SandboxLike>
}

export interface SandboxLogEntry {
  /** ISO time the step started. */
  at: string
  step: string
  ok: boolean
  ms: number
  exitCode?: number
  /** Size of the step's output in bytes, when it has one. */
  bytes?: number
  detail: string
}

export interface SampleMeta {
  filename: string
  sha256: string
  size: number
  url: string | null
  referrer: string | null
  contentType: string | null
}

/** Where a sample lives inside the sandbox, relative to the sandbox user's home folder. */
export const SAMPLE_DIR = 'sample'
export const SAMPLE_PATH = `${SAMPLE_DIR}/file`
export const SAMPLE_META_PATH = `${SAMPLE_DIR}/meta.json`

/** Sandbox start limit, then one retry (architectural.md §4.6). */
export const START_TIMEOUT_S = 20
/** Default time limit for running a sample inside the sandbox. */
export const RUN_TIMEOUT_S = 30

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** A sandbox plus the log of everything done to it. */
export class SandboxSession {
  readonly log: SandboxLogEntry[] = []
  readonly sandbox: SandboxLike

  // No parameter property: Node's type stripping (the try scripts) doesn't support them.
  constructor(sandbox: SandboxLike) {
    this.sandbox = sandbox
  }

  get id(): string {
    return this.sandbox.id
  }

  record(entry: Omit<SandboxLogEntry, 'at' | 'ms'> & { started: number }): void {
    const { started, ...rest } = entry
    this.log.push({
      at: new Date(Date.now() - (performance.now() - started)).toISOString(),
      ms: Math.round(performance.now() - started),
      ...rest
    })
  }

  /** Runs one command inside the sandbox and logs it. Never throws for a non-zero exit. */
  async exec(
    step: string,
    command: string,
    timeoutS = 30
  ): Promise<{ exitCode: number; result: string }> {
    const started = performance.now()
    try {
      const res = await this.sandbox.process.executeCommand(command, undefined, undefined, timeoutS)
      this.record({
        step,
        ok: res.exitCode === 0,
        exitCode: res.exitCode,
        bytes: Buffer.byteLength(res.result ?? ''),
        detail: `exit ${res.exitCode}`,
        started
      })
      return { exitCode: res.exitCode, result: res.result ?? '' }
    } catch (err) {
      this.record({ step, ok: false, detail: explain(err), started })
      throw err
    }
  }

  /**
   * Uploads the sample and its metadata, then checks inside the sandbox that the bytes arrived
   * intact (SHA-256). Throws if they didn't.
   */
  async upload(bytes: Buffer, meta: Omit<SampleMeta, 'sha256' | 'size'>): Promise<SampleMeta> {
    const full: SampleMeta = { ...meta, sha256: sha256Hex(bytes), size: bytes.length }
    const started = performance.now()
    await this.sandbox.fs.createFolder(SAMPLE_DIR, '755')
    await this.sandbox.fs.uploadFile(bytes, SAMPLE_PATH)
    await this.sandbox.fs.uploadFile(Buffer.from(JSON.stringify(full)), SAMPLE_META_PATH)
    this.record({
      step: 'upload',
      ok: true,
      bytes: bytes.length,
      detail: `${SAMPLE_PATH} + ${SAMPLE_META_PATH}`,
      started
    })
    const hashed = await this.exec('check upload', `sha256sum ${SAMPLE_PATH}`)
    const remote = hashed.result.trim().split(/\s+/)[0]
    if (hashed.exitCode !== 0 || remote !== full.sha256) {
      throw new Error(`upload check failed: expected ${full.sha256}, sandbox has ${remote || '?'}`)
    }
    return full
  }

  /**
   * True when neither an ordinary website nor a Daytona "essential service" can be reached. Every
   * probe runs at once, so this takes about one probe's limit, not the sum. A probe command that
   * still runs out of time throws, so the sample is never run on an unproven network.
   */
  async networkIsOff(): Promise<boolean> {
    const res = await this.exec(
      `network probe (${PROBE_URLS.length} hosts × 3 tools, in parallel)`,
      probeCommand(PROBE_URLS),
      PROBE_TOOL_S + 15
    )
    const last = this.log[this.log.length - 1]
    const off = res.result.trim() === 'BLOCKED'
    last.ok = res.exitCode === 0 && off
    last.detail = off ? 'all blocked' : res.result.trim().split('\n').join('; ')
    return last.ok
  }
}

/**
 * Probe targets: an ordinary website, and a Daytona "essential service" (npm), which this
 * account's tier keeps reachable unless the network is blocked at creation (PLAN.md › Sponsor
 * findings › Daytona).
 */
export const PROBE_URLS = ['https://example.com', 'https://registry.npmjs.org/']

/** Hard limit per probe, in seconds. */
export const PROBE_TOOL_S = 8

/**
 * Tries every URL with curl, wget and python3 at once, each capped by `timeout` (wget tries once:
 * by default it retries up to 20 times, logs/2026-10-17-1226-sandbox-run/). Prints
 * `REACHED <tool> <url>` for each one that got through, or `BLOCKED` if none did.
 */
export function probeCommand(urls: string[]): string {
  const tools = (url: string): Array<[string, string]> => [
    ['curl', `curl -sS -m 5 -o /dev/null ${url}`],
    ['wget', `wget -q -T 5 --tries=1 -O /dev/null ${url}`],
    ['python3', `python3 -c "import urllib.request; urllib.request.urlopen('${url}', timeout=5)"`]
  ]
  const jobs = urls.flatMap((url) =>
    tools(url).map(
      ([name, c]) =>
        `(timeout -k 1 ${PROBE_TOOL_S} ${c} && echo "REACHED ${name} ${url}" >>"$P/hits") 2>/dev/null &`
    )
  )
  return [
    'P=$(mktemp -d)',
    ...jobs,
    'wait',
    'if [ -s "$P/hits" ]; then cat "$P/hits"; else echo BLOCKED; fi',
    'rm -rf "$P"'
  ].join('\n')
}

/**
 * Creates a network-off sandbox. Network off is set at creation and checked on the result; a
 * sandbox that comes back with the network on is deleted and refused.
 */
export async function createSandbox(
  client: SandboxClient,
  opts: { labels: Record<string, string>; snapshot?: string; startTimeoutS?: number }
): Promise<SandboxSession> {
  const params: CreateParams = {
    snapshot: opts.snapshot || undefined,
    networkBlockAll: true,
    ephemeral: true,
    autoStopInterval: 5,
    labels: { app: 'aegis', ...opts.labels }
  }
  const timeout = opts.startTimeoutS ?? START_TIMEOUT_S
  const started = performance.now()
  let sandbox: SandboxLike
  let attempts = 1
  try {
    sandbox = await client.create(params, { timeout })
  } catch {
    attempts = 2
    sandbox = await client.create(params, { timeout })
  }
  const session = new SandboxSession(sandbox)
  const off = sandbox.networkBlockAll === true
  session.record({
    step: 'create',
    ok: off,
    detail: `${sandbox.id} from ${params.snapshot ?? 'the default snapshot'}, ${attempts} attempt${
      attempts > 1 ? 's' : ''
    }, networkBlockAll=${sandbox.networkBlockAll}`,
    started
  })
  if (!off) {
    await sandbox.delete(60).catch(() => undefined)
    throw new Error(`sandbox ${sandbox.id} came back with the network on; deleted it`)
  }
  return session
}

/**
 * Creates a network-off sandbox, hands it to `job`, and deletes it in a `finally` whatever
 * happened. The session's log (including the delete) is returned with the job's result or error.
 */
export async function withSandbox<T>(
  client: SandboxClient,
  opts: { labels: Record<string, string>; snapshot?: string; startTimeoutS?: number },
  job: (session: SandboxSession) => Promise<T>
): Promise<{ result?: T; error?: string; log: SandboxLogEntry[]; deleted: boolean }> {
  let session: SandboxSession | undefined
  try {
    session = await createSandbox(client, opts)
    return { result: await job(session), log: session.log, deleted: await remove(session) }
  } catch (err) {
    const deleted = session ? await remove(session) : true
    return { error: explain(err), log: session?.log ?? [], deleted }
  }
}

async function remove(session: SandboxSession): Promise<boolean> {
  const started = performance.now()
  try {
    await session.sandbox.delete(60)
    session.record({ step: 'delete', ok: true, detail: session.id, started })
    return true
  } catch (err) {
    session.record({ step: 'delete', ok: false, detail: `${session.id}: ${explain(err)}`, started })
    return false
  }
}

// ── Running a sample inside the sandbox ─────────────────────────────────────────────────────────

/** What happened when the sample ran inside the sandbox. */
export interface Observation {
  exitCode: number
  timedOut: boolean
  stdout: string
  stderr: string
  /** Commands the shell ran, in order (from `sh -x`). */
  commands: string[]
  /** Files the sample created or changed, relative to its scratch home or work folder. */
  filesWritten: string[]
  /** Commands that tried to reach the network (all blocked: the sandbox has none). */
  networkAttempts: string[]
}

/** The scratch folder the sample runs in, inside the sandbox. */
export const RUN_DIR = '/tmp/aegis-run'

const MAX_CAPTURE = 64 * 1024

/**
 * The shell command that runs the uploaded sample inside the sandbox: a copy of it in a scratch
 * folder, with a scratch `$HOME`, an empty environment except `PATH`, `HOME` and
 * `AEGIS_SANDBOX=1`, `sh -x` to record every command, and a hard time limit. It then prints the
 * exit code, output and the files written since the run started, each base64-encoded.
 */
export function observeCommand(timeoutS: number): string {
  const R = RUN_DIR
  return [
    `rm -rf ${R} && mkdir -p ${R}/home ${R}/work ${R}/out && touch ${R}/out/marker`,
    `cp ${SAMPLE_PATH} ${R}/sample.sh && chmod 500 ${R}/sample.sh`,
    `(cd ${R}/work && env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=${R}/home AEGIS_SANDBOX=1 ` +
      `timeout -k 2 ${timeoutS} sh -x ${R}/sample.sh >${R}/out/stdout 2>${R}/out/stderr); ` +
      `echo $? >${R}/out/exit`,
    `(cd ${R} && find home work -newer out/marker -type f 2>/dev/null) >${R}/out/files`,
    `for f in exit stdout stderr files; do echo "@@$f"; head -c ${MAX_CAPTURE} ${R}/out/$f | base64 -w0; echo; done`
  ].join('; ')
}

const NETWORK_TOOLS =
  /^(curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet|socat)\b|urllib|requests\.|\/dev\/tcp\//

/** Parses `observeCommand`'s output. */
export function parseObservation(output: string): Observation {
  const parts: Record<string, string> = {}
  const re = /^@@(exit|stdout|stderr|files)\n([A-Za-z0-9+/=]*)$/gm
  for (const m of output.matchAll(re)) parts[m[1]] = Buffer.from(m[2], 'base64').toString('utf8')
  if (!('exit' in parts)) throw new Error('the sandbox run printed no result')
  const exitCode = Number.parseInt(parts.exit.trim(), 10)
  const stderr = parts.stderr ?? ''
  const commands = stderr
    .split('\n')
    .filter((l) => /^\++ /.test(l))
    .map((l) => l.replace(/^\++ /, ''))
  return {
    exitCode: Number.isNaN(exitCode) ? -1 : exitCode,
    // `timeout` exits 124, or 137 when it had to kill.
    timedOut: exitCode === 124 || exitCode === 137,
    stdout: parts.stdout ?? '',
    stderr,
    commands,
    filesWritten: (parts.files ?? '').split('\n').filter(Boolean).sort(),
    networkAttempts: commands.filter((c) => NETWORK_TOOLS.test(c))
  }
}

/** Runs the uploaded sample inside the sandbox under a time limit and records what it did. */
export async function runSample(
  session: SandboxSession,
  timeoutS = RUN_TIMEOUT_S
): Promise<Observation> {
  const res = await session.exec('run sample', observeCommand(timeoutS), timeoutS + 30)
  const obs = parseObservation(res.result)
  const last = session.log[session.log.length - 1]
  last.ok = !obs.timedOut
  last.exitCode = obs.exitCode
  last.detail =
    `sample exit ${obs.exitCode}${obs.timedOut ? ' (ran out of time)' : ''}; ` +
    `${obs.commands.length} commands, ${obs.filesWritten.length} files written, ` +
    `${obs.networkAttempts.length} network attempts (blocked)`
  return obs
}

function explain(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
