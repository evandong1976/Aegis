// The sponsor checks against mocked SDKs: no request leaves this machine and no credits are used.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const fake = vi.hoisted(() => ({
  listError: null as unknown,
  createError: null as unknown,
  execResult: { exitCode: 0, result: 'aegis-ok\n' },
  snapshot: { state: 'active' } as { state: string } | null,
  snapshotError: null as unknown,
  create: vi.fn(),
  deleted: vi.fn(),
  listModels: vi.fn(),
  run: vi.fn(),
  dockerStderr: null as string | null
}))

vi.mock('@daytona/sdk', () => ({
  Daytona: class {
    list(): AsyncIterableIterator<unknown> {
      return (async function* () {
        if (fake.listError) throw fake.listError
        yield { id: 'existing' }
      })()
    }
    async create(params: unknown, options: unknown): Promise<unknown> {
      fake.create(params, options)
      if (fake.createError) throw fake.createError
      return {
        id: 'sbx-1',
        process: { executeCommand: async () => fake.execResult },
        delete: async () => fake.deleted()
      }
    }
    snapshot = {
      get: async (name: string) => {
        if (fake.snapshotError) throw fake.snapshotError
        return { name, ...fake.snapshot }
      }
    }
  }
}))

vi.mock('@factory/droid-sdk/node', () => ({
  AutonomyLevel: { Off: 'off' },
  listModels: fake.listModels,
  run: fake.run
}))

vi.mock('child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) =>
    fake.dockerStderr === null
      ? cb(null, 'sha256:abc', '')
      : cb(new Error('docker failed'), '', fake.dockerStderr)
}))

import {
  checkDaytona,
  checkDroid,
  checkSandboxImage,
  findDroidCli,
  type LiveMemory
} from './sponsors'

const ENV = [
  'DAYTONA_API_KEY',
  'FACTORY_API_KEY',
  'DROID_PATH',
  'AEGIS_DAYTONA_SNAPSHOT',
  'AEGIS_CAPTURE_DIR'
]
let saved: Record<string, string | undefined>
let memory: LiveMemory & { data: Map<string, string> }
let dir: string

function apiError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode })
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  const data = new Map<string, string>()
  memory = { data, get: (k) => data.get(k), set: (k, v) => void data.set(k, v) }
  Object.assign(fake, {
    listError: null,
    createError: null,
    execResult: { exitCode: 0, result: 'aegis-ok\n' },
    snapshot: { state: 'active' },
    snapshotError: null,
    dockerStderr: null
  })
  fake.create.mockReset()
  fake.deleted.mockReset()
  fake.listModels.mockReset().mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  fake.run.mockReset().mockResolvedValue({ success: true, subtype: 'success', text: 'OK' })
  dir = await mkdtemp(join(tmpdir(), 'aegis-sponsors-'))
})

afterEach(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('Daytona', () => {
  it('is unconfigured without a key and makes no call', async () => {
    const r = await checkDaytona('start', memory)
    expect(r.state).toBe('unconfigured')
    expect(fake.create).not.toHaveBeenCalled()
  })

  it('reports a rejected key from the lookup', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    fake.listError = apiError(401, 'Unauthorized')
    const r = await checkDaytona(undefined, memory)
    expect(r.state).toBe('down')
    expect(r.detail).toContain('the key was rejected (401)')
  })

  it('every 60 s: lookup only, never a sandbox', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    const r = await checkDaytona(undefined, memory)
    expect(r.state).toBe('ok')
    expect(r.detail).toContain('The live test runs at start and on Check now')
    expect(fake.create).not.toHaveBeenCalled()
  })

  it('at start: a network-off ephemeral sandbox, 20 s start limit, deleted after', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    process.env.AEGIS_DAYTONA_SNAPSHOT = 'aegis-v1'
    const r = await checkDaytona('start', memory)
    expect(fake.create).toHaveBeenCalledTimes(1)
    const [params, options] = fake.create.mock.calls[0]
    expect(params).toMatchObject({ snapshot: 'aegis-v1', networkBlockAll: true, ephemeral: true })
    expect(options).toEqual({ timeout: 20 })
    expect(fake.deleted).toHaveBeenCalledTimes(1)
    expect(r.state).toBe('ok')
    expect(r.detail).toMatch(/Live test just now: sandbox started in \d+\.\d s/)
    expect(JSON.parse(memory.data.get('live.daytona') ?? '{}')).toMatchObject({ ok: true })
  })

  it('reuses a passing test at start for 15 minutes, across launches', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    vi.useFakeTimers({ toFake: ['Date'] })
    await checkDaytona('start', memory)
    vi.setSystemTime(Date.now() + 14 * 60_000)
    await checkDaytona('start', memory)
    expect(fake.create).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await checkDaytona('start', memory)
    expect(fake.create).toHaveBeenCalledTimes(2)
  })

  it('Check now runs the test, but not twice within 30 s', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    vi.useFakeTimers({ toFake: ['Date'] })
    await checkDaytona('manual', memory)
    vi.setSystemTime(Date.now() + 10_000)
    await checkDaytona('manual', memory)
    expect(fake.create).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 30_000)
    await checkDaytona('manual', memory)
    expect(fake.create).toHaveBeenCalledTimes(2)
  })

  it('a failed test command is down, and the sandbox is still deleted', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    fake.execResult = { exitCode: 1, result: '' }
    const r = await checkDaytona('start', memory)
    expect(r.state).toBe('down')
    expect(r.detail).toContain('the live sandbox test failed: the test command exited 1')
    expect(fake.deleted).toHaveBeenCalledTimes(1)
  })

  it('a sandbox that never starts is down, and the failure is retried at the next start', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    fake.createError = new Error('no capacity')
    expect((await checkDaytona('start', memory)).state).toBe('down')
    expect(fake.deleted).not.toHaveBeenCalled()
    // The 60 s loop keeps showing the failure without retrying it.
    expect((await checkDaytona(undefined, memory)).detail).toContain('no capacity')
    expect(fake.create).toHaveBeenCalledTimes(1)
    fake.createError = null
    expect((await checkDaytona('start', memory)).state).toBe('ok')
    expect(fake.create).toHaveBeenCalledTimes(2)
  })

  it('never runs a live test during a dev capture', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    process.env.AEGIS_CAPTURE_DIR = '/tmp/capture'
    await checkDaytona('start', memory)
    await checkDaytona('manual', memory)
    expect(fake.create).not.toHaveBeenCalled()
  })
})

describe('Droid', () => {
  async function fakeCli(): Promise<string> {
    const path = join(dir, 'droid')
    await writeFile(path, '#!/bin/sh\n')
    await chmod(path, 0o755)
    return path
  }

  it('is unconfigured without a key', async () => {
    expect((await checkDroid('start', memory)).state).toBe('unconfigured')
    expect(fake.run).not.toHaveBeenCalled()
  })

  it('is down with install steps when the CLI is missing', async () => {
    process.env.FACTORY_API_KEY = 'k'
    process.env.DROID_PATH = join(dir, 'missing', 'droid')
    const r = await checkDroid('start', memory)
    expect(r.state).toBe('down')
    expect(r.detail).toContain('brew install --cask droid')
    expect(fake.listModels).not.toHaveBeenCalled()
  })

  it('every 60 s: lists models only, never a prompt', async () => {
    process.env.FACTORY_API_KEY = 'k'
    process.env.DROID_PATH = await fakeCli()
    const r = await checkDroid(undefined, memory)
    expect(r.state).toBe('ok')
    expect(r.detail).toContain('Key works (2 models)')
    expect(fake.listModels).toHaveBeenCalledWith({ apiKey: 'k', execPath: process.env.DROID_PATH })
    expect(fake.run).not.toHaveBeenCalled()
  })

  it('at start: one tiny prompt, every tool request refused, in an empty folder', async () => {
    process.env.FACTORY_API_KEY = 'k'
    process.env.DROID_PATH = await fakeCli()
    const r = await checkDroid('start', memory)
    expect(fake.run).toHaveBeenCalledTimes(1)
    const [, options] = fake.run.mock.calls[0]
    expect(options).toMatchObject({
      apiKey: 'k',
      execPath: process.env.DROID_PATH,
      autonomyLevel: 'off',
      autoRejectPermissionRequests: true
    })
    expect(options.cwd).toContain('aegis-droid-check-')
    expect(r.state).toBe('ok')
    expect(r.detail).toMatch(/Droid answered a test prompt in \d+\.\d s/)
  })

  it('carries the file-type reference, like every Droid call', async () => {
    process.env.FACTORY_API_KEY = 'k'
    process.env.DROID_PATH = await fakeCli()
    await checkDroid('start', memory)
    const [, options] = fake.run.mock.calls[0]
    expect(options.systemPrompt).toMatchObject({ type: 'preset', preset: 'droid' })
    expect(options.systemPrompt.append).toContain('file_types_vulnerabilities.md')
    expect(options.systemPrompt.append).toContain('| `.pdf` |')
  })

  it('a rejected key or a failed run is down', async () => {
    process.env.FACTORY_API_KEY = 'k'
    process.env.DROID_PATH = await fakeCli()
    fake.listModels.mockRejectedValueOnce(apiError(401, 'Unauthorized'))
    expect((await checkDroid(undefined, memory)).detail).toContain('the key was rejected (401)')
    fake.run.mockResolvedValueOnce({
      success: false,
      subtype: 'error',
      error: { message: 'quota' }
    })
    const r = await checkDroid('start', memory)
    expect(r.state).toBe('down')
    expect(r.detail).toContain('the live Droid test failed: quota')
  })

  it('finds the CLI on PATH or in the fallback folders, or DROID_PATH only', async () => {
    const cli = await fakeCli()
    expect(await findDroidCli({ PATH: dir }, [])).toBe(cli)
    expect(await findDroidCli({ PATH: '' }, [dir])).toBe(cli)
    expect(await findDroidCli({ PATH: '' }, [])).toBeNull()
    expect(await findDroidCli({ PATH: dir, DROID_PATH: join(dir, 'nope') }, [])).toBeNull()
  })
})

describe('sandbox image', () => {
  it('is pending with no snapshot set and no local image', async () => {
    fake.dockerStderr = 'Error: No such image: aegis-sandbox'
    const r = await checkSandboxImage()
    expect(r.state).toBe('pending')
    expect(r.detail).toContain('No Daytona snapshot set yet')
    expect(r.detail).toContain('no local Docker image aegis-sandbox')
  })

  it('is ok when the local image exists', async () => {
    expect((await checkSandboxImage()).state).toBe('ok')
  })

  it('is ok when the Daytona snapshot is active', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    process.env.AEGIS_DAYTONA_SNAPSHOT = 'aegis-v1'
    fake.dockerStderr = 'Cannot connect to the Docker daemon'
    const r = await checkSandboxImage()
    expect(r.state).toBe('ok')
    expect(r.detail).toBe(
      'Daytona snapshot aegis-v1 is active; Docker not running, so no local image.'
    )
  })

  it('is down when the named snapshot is missing and there is no local image', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    process.env.AEGIS_DAYTONA_SNAPSHOT = 'aegis-v1'
    fake.snapshotError = apiError(404, 'Not Found')
    fake.dockerStderr = 'No such image'
    const r = await checkSandboxImage()
    expect(r.state).toBe('down')
    expect(r.detail).toContain('No Daytona snapshot named aegis-v1')
  })

  it('is degraded while the snapshot is still building', async () => {
    process.env.DAYTONA_API_KEY = 'k'
    process.env.AEGIS_DAYTONA_SNAPSHOT = 'aegis-v1'
    fake.snapshot = { state: 'building' }
    expect((await checkSandboxImage()).state).toBe('degraded')
  })
})
