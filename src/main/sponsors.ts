// Live checks for the sponsor services Aegis depends on (BUILD_PROMPT §4.1, docs/PLAN.md › Sponsor
// findings): Daytona, the sandbox image and Factory Droid. health.ts calls these.
//
// Two depths, because live tests use credits (PLAN.md decision 27):
// - Lookup, on every check (every 60 s): free calls only. Daytona lists sandboxes and looks up the
//   snapshot; Droid lists models through its CLI.
// - Live test, at start and on Check now only: Daytona creates a tiny network-off sandbox, runs one
//   command and deletes it; Droid answers one tiny prompt. A passing result is reused at start for
//   15 minutes (across launches) and on Check now for 30 seconds, and shown until the next test.
//   Dev captures (AEGIS_CAPTURE_DIR, used by pnpm capture and pnpm verify) never run live tests.

import { execFile } from 'child_process'
import { constants as fsConstants } from 'fs'
import { access, mkdtemp, rm } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { ServiceState } from '@shared/types'
import { status } from './status'

/** What asked for the check: app start or Check now may run live tests; the 60 s loop never does. */
export type LiveTrigger = 'start' | 'manual'

/** Where live-test results persist between launches (the store's settings table). */
export interface LiveMemory {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

export interface SponsorCheck {
  state: ServiceState
  detail: string
  latencyMs?: number
}

interface LiveResult {
  at: number
  ok: boolean
  /** Lower-case clause: "sandbox started in 2.1 s, ran a command and was deleted". */
  detail: string
}

/** The local Docker image built from sandbox/Dockerfile (`docker build -t aegis-sandbox sandbox/`). */
export const LOCAL_SANDBOX_IMAGE = 'aegis-sandbox'

const START_REUSE_MS = 15 * 60_000
const MANUAL_REUSE_MS = 30_000
const LOOKUP_TIMEOUT_MS = 15_000
/** Sandbox start limit (architectural.md §4.6). */
const SANDBOX_START_S = 20
/** Per-worker limit (architectural.md §4.6). */
const DROID_TIMEOUT_MS = 120_000
const DROID_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]

export async function checkDaytona(
  trigger?: LiveTrigger,
  memory?: LiveMemory
): Promise<SponsorCheck> {
  if (!process.env.DAYTONA_API_KEY) {
    return {
      state: 'unconfigured',
      detail: 'DAYTONA_API_KEY not set. Add it to .env.local, then restart Aegis.'
    }
  }
  const { Daytona } = await import('@daytona/sdk')
  const daytona = new Daytona()
  const started = Date.now()
  try {
    const sandboxes = daytona.list({ limit: 1 })
    await withTimeout(sandboxes.next(), LOOKUP_TIMEOUT_MS)
    await sandboxes.return?.(undefined)
  } catch (err) {
    return { state: 'down', detail: `Daytona API: ${explain(err)}. Docker is the fallback.` }
  }
  const lookupMs = Date.now() - started

  let last = readLive(memory, 'daytona')
  if (due(last, trigger)) {
    last = await daytonaLiveTest(daytona)
    writeLive(memory, 'daytona', last)
  }
  return summarize('API reachable and the key works', last, lookupMs, 'Docker is the fallback')
}

async function daytonaLiveTest(
  daytona: InstanceType<typeof import('@daytona/sdk').Daytona>
): Promise<LiveResult> {
  const t0 = Date.now()
  let sandbox: Awaited<ReturnType<typeof daytona.create>> | undefined
  try {
    sandbox = await daytona.create(
      {
        snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || undefined,
        networkBlockAll: true,
        ephemeral: true,
        autoStopInterval: 5,
        labels: { app: 'aegis', job: 'health' }
      },
      { timeout: SANDBOX_START_S }
    )
    const startupMs = Date.now() - t0
    const out = await sandbox.process.executeCommand('echo aegis-ok', undefined, undefined, 15)
    if (out.exitCode !== 0 || !out.result.includes('aegis-ok')) {
      throw new Error(`the test command exited ${out.exitCode}`)
    }
    status.record('allow', `daytona live test sandbox=${sandbox.id} startup_ms=${startupMs}`)
    return {
      at: Date.now(),
      ok: true,
      detail: `sandbox started in ${seconds(startupMs)}, ran a command and was deleted`
    }
  } catch (err) {
    status.record('warn', `daytona live test failed: ${explain(err)}`)
    return { at: Date.now(), ok: false, detail: `the live sandbox test failed: ${explain(err)}` }
  } finally {
    const s = sandbox
    if (s) {
      await s.delete(60).catch((err: unknown) => {
        status.record('warn', `daytona delete failed sandbox=${s.id}: ${explain(err)}`)
      })
    }
  }
}

export async function checkDroid(
  trigger?: LiveTrigger,
  memory?: LiveMemory
): Promise<SponsorCheck> {
  const apiKey = process.env.FACTORY_API_KEY
  if (!apiKey) {
    return {
      state: 'unconfigured',
      detail: 'FACTORY_API_KEY not set. Add it to .env.local, then restart Aegis.'
    }
  }
  const execPath = await findDroidCli()
  if (!execPath) {
    const where = process.env.DROID_PATH ? `at ${process.env.DROID_PATH}` : 'found'
    return {
      state: 'down',
      detail: `No droid CLI ${where}. Install it (brew install --cask droid) or set DROID_PATH in .env.local, then restart Aegis. Reports run without Droid until then.`
    }
  }
  const sdk = await import('@factory/droid-sdk/node')
  const started = Date.now()
  let models: number
  try {
    models = (await withTimeout(sdk.listModels({ apiKey, execPath }), LOOKUP_TIMEOUT_MS)).length
  } catch (err) {
    return {
      state: 'down',
      detail: `Factory API through ${execPath}: ${explain(err)}. Reports run without Droid.`
    }
  }
  const lookupMs = Date.now() - started

  let last = readLive(memory, 'droid')
  if (due(last, trigger)) {
    last = await droidLiveTest(sdk, apiKey, execPath)
    writeLive(memory, 'droid', last)
  }
  return summarize(
    `Key works (${models} models) through ${execPath}`,
    last,
    lookupMs,
    'reports run without Droid'
  )
}

async function droidLiveTest(
  sdk: typeof import('@factory/droid-sdk/node'),
  apiKey: string,
  execPath: string
): Promise<LiveResult> {
  // An empty working directory, and every tool request refused: the test can't touch this Mac.
  const cwd = await mkdtemp(join(tmpdir(), 'aegis-droid-check-'))
  const t0 = Date.now()
  try {
    const result = await sdk.run('Reply with the single word OK.', {
      cwd,
      execPath,
      apiKey,
      autonomyLevel: sdk.AutonomyLevel.Off,
      autoRejectPermissionRequests: true,
      abortSignal: AbortSignal.timeout(DROID_TIMEOUT_MS)
    })
    if (!result.success)
      throw new Error(result.error?.message ?? `the run ended: ${result.subtype}`)
    const ms = Date.now() - t0
    status.record('allow', `droid live test ms=${ms}`)
    return { at: Date.now(), ok: true, detail: `Droid answered a test prompt in ${seconds(ms)}` }
  } catch (err) {
    status.record('warn', `droid live test failed: ${explain(err)}`)
    return { at: Date.now(), ok: false, detail: `the live Droid test failed: ${explain(err)}` }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/** The Aegis snapshot in Daytona and the local Docker image. Lookups only; building is milestone 3. */
export async function checkSandboxImage(): Promise<SponsorCheck> {
  const name = process.env.AEGIS_DAYTONA_SNAPSHOT
  const parts: string[] = []
  let snapshot: 'active' | 'not-ready' | 'missing' | 'error' | 'unset' = 'unset'
  if (name && process.env.DAYTONA_API_KEY) {
    try {
      const { Daytona } = await import('@daytona/sdk')
      const snap = await withTimeout(new Daytona().snapshot.get(name), LOOKUP_TIMEOUT_MS)
      snapshot = snap.state === 'active' ? 'active' : 'not-ready'
      parts.push(`Daytona snapshot ${name} is ${snap.state}`)
    } catch (err) {
      snapshot = statusCode(err) === 404 ? 'missing' : 'error'
      parts.push(
        snapshot === 'missing'
          ? `no Daytona snapshot named ${name}`
          : `Daytona snapshot lookup failed: ${explain(err)}`
      )
    }
  } else if (name) {
    parts.push(`Daytona snapshot ${name} not checked: DAYTONA_API_KEY not set`)
  } else {
    parts.push(
      'no Daytona snapshot set yet (pnpm build:sandbox, milestone 3; then AEGIS_DAYTONA_SNAPSHOT)'
    )
  }

  const local = await localImage()
  parts.push(
    local === 'found'
      ? `local Docker image ${LOCAL_SANDBOX_IMAGE} found`
      : local === 'missing'
        ? `no local Docker image ${LOCAL_SANDBOX_IMAGE}`
        : 'Docker not running, so no local image'
  )

  const detail = capitalize(parts.join('; ')) + '.'
  if (snapshot === 'active') return { state: 'ok', detail }
  if (snapshot === 'unset') return { state: local === 'found' ? 'ok' : 'pending', detail }
  if (snapshot === 'not-ready') return { state: 'degraded', detail }
  return { state: local === 'found' ? 'degraded' : 'down', detail }
}

/** DROID_PATH if set; otherwise the first `droid` on PATH or in the usual install folders. */
export async function findDroidCli(
  env: NodeJS.ProcessEnv = process.env,
  fallbackDirs: string[] = DROID_DIRS
): Promise<string | null> {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...fallbackDirs]
  const candidates = env.DROID_PATH ? [env.DROID_PATH] : dirs.map((d) => join(d, 'droid'))
  for (const path of candidates) {
    try {
      await access(path, fsConstants.X_OK)
      return path
    } catch {
      // try the next one
    }
  }
  return null
}

function localImage(): Promise<'found' | 'missing' | 'no-docker'> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['image', 'inspect', LOCAL_SANDBOX_IMAGE, '--format', '{{.Id}}'],
      { timeout: 4000 },
      (err, _stdout, stderr) => {
        if (!err) resolve('found')
        else resolve(/no such image/i.test(String(stderr)) ? 'missing' : 'no-docker')
      }
    )
  })
}

/** Should this check run a live test now? */
function due(last: LiveResult | null, trigger?: LiveTrigger): boolean {
  if (!trigger || process.env.AEGIS_CAPTURE_DIR) return false
  if (!last) return true
  const age = Date.now() - last.at
  if (trigger === 'manual') return age >= MANUAL_REUSE_MS
  return !last.ok || age >= START_REUSE_MS
}

function summarize(
  base: string,
  last: LiveResult | null,
  latencyMs: number,
  fallback: string
): SponsorCheck {
  if (!last) {
    return {
      state: 'ok',
      detail: `${base}. The live test runs at start and on Check now.`,
      latencyMs
    }
  }
  const when = ago(last.at)
  return last.ok
    ? { state: 'ok', detail: `${base}. Live test ${when}: ${last.detail}.`, latencyMs }
    : {
        state: 'down',
        detail: `${base}, but ${last.detail} (${when}); ${fallback}. Check now retries.`,
        latencyMs
      }
}

const memo = new Map<string, string>()

function readLive(memory: LiveMemory | undefined, service: string): LiveResult | null {
  const raw = (memory ?? memoryFallback).get(`live.${service}`)
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as LiveResult
    return typeof r.at === 'number' && typeof r.ok === 'boolean' ? r : null
  } catch {
    return null
  }
}

function writeLive(memory: LiveMemory | undefined, service: string, result: LiveResult): void {
  ;(memory ?? memoryFallback).set(`live.${service}`, JSON.stringify(result))
}

const memoryFallback: LiveMemory = { get: (k) => memo.get(k), set: (k, v) => void memo.set(k, v) }

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function statusCode(err: unknown): number | undefined {
  const code = (err as { statusCode?: unknown })?.statusCode
  return typeof code === 'number' ? code : undefined
}

function explain(err: unknown): string {
  const code = statusCode(err)
  if (code === 401) return 'the key was rejected (401)'
  if (code === 403) return 'the key is not allowed to do this (403)'
  const text = err instanceof Error ? err.message : String(err)
  return code ? `${text} (${code})` : text
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
