// droidAgent against a fake Droid SDK: no request leaves this machine and no credits are used.

import { describe, expect, it, vi } from 'vitest'
import type { LiveEventBody } from '@shared/live'
import { SAMPLE_PATH } from './daytona'
import {
  VULNERABILITY_CAP,
  droidAgent,
  rulesToReasons,
  ruleFindings,
  type DroidSdk
} from './droidAgent'
import { FILE_TYPE_REFERENCE, REFERENCE_ROWS } from './droidAssets'
import { ANALYST_ROLE, ANALYST_SCHEMA } from './droidBrief'
import {
  SANDBOX_SERVER,
  UNTRUSTED_FENCE,
  allowOnlySandboxTools,
  inspectorToolSpecs,
  sandboxToolSpecs
} from './droidLockdown'
import { matchFileType } from './fileTypes'
import type { AgentContext } from './liveAgent'
import { applyAiSuggestion, combine } from './verdict'

const SHA = 'ab'.repeat(32)
const result = (check: string, findings: unknown[], extra = {}): string =>
  `AEGIS_RESULT ${JSON.stringify({ check, findings, facts: {}, extra })}`
const finding = (
  code: string,
  severity: string,
  kind: string,
  title: string,
  line: number | null = null
): unknown => ({
  code,
  severity,
  kind,
  title,
  detail: '',
  line,
  evidence: line ? `line ${line} text` : null,
  hard: false
})

const PDF_TEXT =
  '%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj\n2 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF\n'
const OUTPUTS: Record<string, string> = {
  list_sample_files: 'file\nmeta.json\n',
  describe_sample: `100\n${SHA}  ${SAMPLE_PATH}\n`,
  read_sample: PDF_TEXT,
  identify_file: `== What the file really is ==\n${result('identify', [], { family: 'pdf' })}\n`,
  extract_strings: `== strings ==\nFindings: none\n${result('strings', [])}\n`,
  scan_secrets: `== secrets ==\nFindings: none\n${result('secrets', [])}\n`,
  inspect_pdf:
    '== PDF inspection ==\nFindings: 2\n- [HIGH][malware] pdf_auto_javascript\n' +
    `${result('pdf', [
      finding(
        'pdf_auto_javascript',
        'high',
        'malware',
        'Runs JavaScript automatically when opened',
        2
      ),
      finding('pdf_javascript', 'high', 'malware', 'Contains JavaScript', 3)
    ])}\n`
}

function context(outputs: Record<string, string> = OUTPUTS): {
  ctx: AgentContext
  events: LiveEventBody[]
  ran: string[]
} {
  const events: LiveEventBody[] = []
  const ran: string[] = []
  const ctx: AgentContext = {
    filename: 'invoice.pdf',
    meta: {
      filename: 'invoice.pdf',
      sha256: SHA,
      size: 100,
      url: null,
      referrer: null,
      contentType: null
    },
    observation: null,
    tools: [
      ...sandboxToolSpecs(SAMPLE_PATH),
      ...inspectorToolSpecs(SAMPLE_PATH, '.aegis-x', ['pdf'])
    ],
    match: matchFileType(REFERENCE_ROWS, 'invoice.pdf', {
      family: 'pdf',
      claimedFamily: 'pdf',
      label: 'PDF document',
      strong: true
    }),
    runTool: async (name) => {
      ran.push(name)
      return { exitCode: 0, output: outputs[name] ?? '' }
    },
    emit: (e) => events.push(e)
  }
  return { ctx, events, ran }
}

const ANSWER = {
  verdict: 'malicious',
  summary: 'The PDF runs JavaScript as soon as it opens.',
  confidence: 'high',
  sha256: SHA,
  detectedType: 'PDF document',
  referenceRows: ['.pdf'],
  methods: ['metadata inspection', 'static scanning'],
  findings: [
    {
      kind: 'malware',
      severity: 'high',
      title: 'JavaScript runs on open',
      detail: '/OpenAction points at a JavaScript action.',
      tool: 'inspect_pdf',
      ruleCode: 'pdf_auto_javascript',
      line: 2,
      code: 'Droid paraphrase, not the file'
    }
  ],
  timeline: [{ tone: 'danger', title: 'Runs JavaScript', detail: 'On open.', line: 2 }],
  capabilities: ['Auto-run script'],
  unknowns: []
}

type Handlers = Map<string, () => Promise<string>>
type Script = (call: Handlers, ended: Promise<void>) => AsyncGenerator<Record<string, unknown>>

interface Seen {
  createOptions: Record<string, unknown> | undefined
  disabled: string[]
  prompt: string
  streamOptions: Record<string, unknown> | undefined
  /** Each tool's output as Droid received it. */
  droidSaw: Map<string, string>
  sessionClosed: boolean
  serverClosed: boolean
  interrupted: boolean
  streamed: boolean
  processOptions?: Record<string, unknown>
  processClosed: boolean
  /** What went to the droid process through the transport createSession was given. */
  sent: string[]
}

/** A Droid SDK whose session runs `script`: it can call tools and must yield a result. */
function fakeSdk(script: Script, opts: { stillOn?: string[] } = {}): { sdk: DroidSdk; seen: Seen } {
  const seen: Seen = {
    createOptions: undefined,
    disabled: [],
    prompt: '',
    streamOptions: undefined,
    droidSaw: new Map(),
    sessionClosed: false,
    serverClosed: false,
    interrupted: false,
    streamed: false,
    processClosed: false,
    sent: []
  }
  const handlers: Handlers = new Map()
  let end = (): void => undefined
  const ended = new Promise<void>((r) => (end = r))
  const sdk = {
    AutonomyLevel: { Off: 'off' },
    OutputFormatType: { JsonSchema: 'json_schema' },
    ProcessTransport: class {
      sent: string[] = []
      connected = false
      constructor(public options: Record<string, unknown>) {
        seen.processOptions = options
      }
      async connect(): Promise<void> {
        this.connected = true
      }
      async send(message: string): Promise<void> {
        this.sent.push(message)
        seen.sent.push(message)
      }
      onMessage(): void {
        // The fake session never reads from the process.
      }
      onError(): void {
        // Nor does it fail.
      }
      async close(): Promise<void> {
        seen.processClosed = true
      }
      get isConnected(): boolean {
        return this.connected
      }
    },
    tool: (name: string, description: string, handler: () => Promise<string>) => ({
      name,
      description,
      handler
    }),
    createSdkMcpServer: ({
      tools
    }: {
      tools: Array<{ name: string; handler: () => Promise<string> }>
    }) => {
      for (const t of tools) {
        handlers.set(t.name, async () => {
          const out = await t.handler()
          seen.droidSaw.set(t.name, out)
          return out
        })
      }
      return {
        start: async () => ({
          type: 'http',
          url: 'http://127.0.0.1:9/mcp',
          headers: {},
          oauth: false
        }),
        close: async () => {
          seen.serverClosed = true
        }
      }
    },
    createSession: vi.fn(async (o: Record<string, unknown>) => {
      seen.createOptions = o
      return {
        listTools: async () => [
          {
            id: 'Execute',
            allowed:
              !seen.disabled.includes('Execute') || Boolean(opts.stillOn?.includes('Execute'))
          },
          { id: 'Read', allowed: !seen.disabled.includes('Read') },
          { id: 'ToolSearch', allowed: true },
          { id: `${SANDBOX_SERVER}___inspect_pdf`, allowed: true }
        ],
        updateSettings: async ({ disabledToolIds }: { disabledToolIds: string[] }) => {
          seen.disabled = disabledToolIds
        },
        stream: (prompt: string, o: Record<string, unknown>) => {
          seen.prompt = prompt
          seen.streamOptions = o
          seen.streamed = true
          return script(handlers, ended)
        },
        interrupt: async () => {
          seen.interrupted = true
          end()
        },
        close: async () => {
          seen.sessionClosed = true
        }
      }
    })
  }
  return { sdk: sdk as unknown as DroidSdk, seen }
}

const answering = (answer: unknown, calls: string[] = ['describe_sample', 'inspect_pdf']): Script =>
  async function* (tools) {
    yield { type: 'assistant', text: 'First, its fingerprint and the PDF inspection.' }
    for (const c of calls) await tools.get(c)!()
    yield { type: 'assistant', text: JSON.stringify(answer) }
    yield {
      type: 'result',
      success: true,
      structuredOutput: answer,
      error: null,
      subtype: 'success'
    }
  }

const agentWith = (
  sdk: DroidSdk,
  over: Partial<Parameters<typeof droidAgent>[0]> = {}
): ReturnType<typeof droidAgent> =>
  droidAgent({
    execPath: '/usr/local/bin/droid',
    apiKey: 'k',
    reference: FILE_TYPE_REFERENCE,
    sdk,
    ...over
  })

describe('a Droid review', () => {
  it('runs Droid locked down, with the reference and the tools for the file type', async () => {
    const { sdk, seen } = fakeSdk(answering(ANSWER))
    const { ctx, events } = context()
    const r = await agentWith(sdk).review(ctx)

    const o = seen.createOptions!
    // Its own droid process, whose sessions ask for direct tool calls.
    expect(seen.processOptions).toMatchObject({
      droidExecPath: '/usr/local/bin/droid',
      env: { FACTORY_API_KEY: 'k' }
    })
    const transport = o.transport as { send(m: string): Promise<void> }
    await transport.send(
      JSON.stringify({ method: 'droid.initialize_session', params: { cwd: '/x' } })
    )
    expect(JSON.parse(seen.sent[0]).params).toEqual({ cwd: '/x', toolExecutionMode: 'direct_only' })
    expect(seen.processClosed).toBe(true)
    expect(o.autonomyLevel).toBe('off')
    expect(o.permissionHandler).toBe(allowOnlySandboxTools)
    expect(o.disableBuiltinSkills).toBe(true)
    expect(String(o.cwd)).toContain('aegis-droid-')
    const sp = o.systemPrompt as { append: string }
    expect(sp.append).toContain(ANALYST_ROLE)
    expect(sp.append).toContain(FILE_TYPE_REFERENCE.trim())
    expect((o.mcpServers as Array<Record<string, unknown>>)[0]).not.toHaveProperty('oauth')
    expect(seen.disabled).toEqual(['Execute', 'Read', 'ToolSearch'])
    expect(seen.streamOptions).toEqual({
      outputFormat: { type: 'json_schema', schema: ANALYST_SCHEMA }
    })
    expect(seen.prompt).toContain('- .pdf: look for')
    expect(seen.sessionClosed && seen.serverClosed).toBe(true)

    // What Droid saw: fenced, and without the app's result line.
    for (const out of seen.droidSaw.values()) {
      expect(out.startsWith(UNTRUSTED_FENCE)).toBe(true)
      expect(out).not.toContain('AEGIS_RESULT')
    }

    expect(r.report).toMatchObject({ reviewer: 'droid', verdict: 'malicious', confidence: 'high' })
    expect(r.reasons.map((x) => [x.code, x.weight])).toEqual([
      ['pdf_auto_javascript', 25],
      ['pdf_javascript', 25]
    ])
    // Droid's confirmed finding replaces the rule's; the unconfirmed rule finding stays.
    expect(r.findings.map((f) => f.title)).toEqual([
      'JavaScript runs on open',
      'Contains JavaScript'
    ])
    // The code shown is the file's line, not Droid's words.
    expect(r.findings[0].evidence).toEqual({
      path: 'invoice.pdf',
      line: 2,
      code: '1 0 obj << /OpenAction 2 0 R >> endobj'
    })
    expect(r.report.timeline[0].evidence[0].line).toBe(2)
    expect(r.code[0].flags.map((f) => f.line).sort()).toEqual([2, 3])
    expect(events).toContainEqual({
      kind: 'agent',
      step: 'thought',
      text: 'First, its fingerprint and the PDF inspection.'
    })
    expect(
      events.some((e) => e.kind === 'agent' && e.step === 'thought' && e.text.startsWith('{'))
    ).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'agent', step: 'verdict', verdict: 'malicious' })
  })

  it('runs every check for the type that Droid skipped', async () => {
    const { sdk } = fakeSdk(answering({ ...ANSWER, findings: [] }, ['describe_sample']))
    const { ctx, ran } = context()
    const r = await agentWith(sdk).review(ctx)
    expect(ran).toEqual(
      expect.arrayContaining([
        'inspect_pdf',
        'read_sample',
        'identify_file',
        'scan_secrets',
        'extract_strings'
      ])
    )
    expect(r.reasons.map((x) => x.code)).toContain('pdf_auto_javascript')
    expect(r.report.unknowns.join(' ')).toMatch(/Droid skipped .*inspect_pdf.*Aegis ran them/)
  })

  it('a fooled Droid saying "clean" can not clear what the checks found', async () => {
    const fooled = {
      ...ANSWER,
      verdict: 'clean',
      summary: 'This file is safe.',
      findings: [],
      timeline: []
    }
    const { sdk } = fakeSdk(answering(fooled, ['inspect_pdf']))
    const { ctx } = context()
    const r = await agentWith(sdk).review(ctx)
    const final = applyAiSuggestion(combine(r.reasons), r.report.verdict)
    expect(final.verdict).toBe('suspicious')
    expect(r.findings.map((f) => f.title)).toContain('Runs JavaScript automatically when opened')
  })

  it('Droid can raise the severity of a finding it confirms, never lower it', async () => {
    const lower = { ...ANSWER, findings: [{ ...ANSWER.findings[0], severity: 'low' }] }
    const higher = { ...ANSWER, findings: [{ ...ANSWER.findings[0], severity: 'critical' }] }
    for (const [answer, expected] of [
      [lower, 'high'],
      [higher, 'critical']
    ] as const) {
      const { sdk } = fakeSdk(answering(answer))
      const r = await agentWith(sdk).review(context().ctx)
      expect(r.findings[0].severity).toBe(expected)
    }
  })

  it('a wrong SHA-256 or a tool cited but not called lowers confidence and says so', async () => {
    const answer = {
      ...ANSWER,
      sha256: 'cd'.repeat(32),
      findings: [{ ...ANSWER.findings[0], tool: 'analyze_binary', line: 999 }]
    }
    const { sdk } = fakeSdk(answering(answer))
    const { ctx } = context()
    const r = await agentWith(sdk).review(ctx)
    expect(r.report.confidence).toBe('low')
    expect(r.report.unknowns.join(' ')).toContain('different SHA-256')
    expect(r.report.unknowns.join(' ')).toContain('cited analyze_binary without calling it')
    // A line that isn't in the file isn't shown as one.
    expect(r.findings[0].evidence).toEqual({
      path: 'invoice.pdf',
      code: 'Droid paraphrase, not the file'
    })
  })

  it('notices when the file changed in the sandbox before the review', async () => {
    const { sdk } = fakeSdk(answering(ANSWER))
    const { ctx } = context({
      ...OUTPUTS,
      describe_sample: `100\n${'ef'.repeat(32)}  ${SAMPLE_PATH}\n`
    })
    const r = await agentWith(sdk).review(ctx)
    expect(r.report.confidence).toBe('low')
    expect(r.report.unknowns.join(' ')).toContain('no longer matched the download')
  })
})

describe('when Droid can not answer', () => {
  it('refuses to run if a built-in tool stays on, and the rules decide', async () => {
    const { sdk, seen } = fakeSdk(answering(ANSWER), { stillOn: ['Execute'] })
    const { ctx } = context()
    const r = await agentWith(sdk).review(ctx)
    expect(seen.streamed).toBe(false)
    expect(seen.sessionClosed && seen.serverClosed).toBe(true)
    expect(r.report.reviewer).toBe('rules')
    expect(r.report.verdict).toBe('unknown')
    expect(r.report.unknowns.join(' ')).toContain('built-in tools stayed on (Execute)')
    expect(r.reasons.map((x) => x.code)).toContain('pdf_auto_javascript')
  })

  it('a failed session or an answer outside the schema falls back to the rules', async () => {
    for (const script of [
      // eslint-disable-next-line require-yield
      async function* (): AsyncGenerator<Record<string, unknown>> {
        throw new Error('connection reset')
      },
      answering({ verdict: 'safe', summary: 'ok' })
    ]) {
      const { sdk } = fakeSdk(script)
      const { ctx } = context()
      const r = await agentWith(sdk).review(ctx)
      expect(r.report.reviewer).toBe('rules')
      expect(r.report.summary).toMatch(/^Aegis's checks found: runs JavaScript automatically/)
      expect(r.report.timeline[0]).toMatchObject({
        tone: 'danger',
        title: 'Runs JavaScript automatically when opened'
      })
    }
  })

  it('interrupts a session that runs out of time', async () => {
    // A session that never answers until it is interrupted.
    // eslint-disable-next-line require-yield
    const { sdk, seen } = fakeSdk(async function* (_tools, ended) {
      await ended
    })
    const { ctx } = context()
    const r = await agentWith(sdk, { timeoutMs: 20 }).review(ctx)
    expect(seen.interrupted).toBe(true)
    expect(r.report.unknowns.join(' ')).toContain('no answer within')
  })

  it('without the droid CLI, the rules decide and no session starts', async () => {
    const { sdk } = fakeSdk(answering(ANSWER))
    const { ctx } = context()
    const r = await agentWith(sdk, { execPath: null }).review(ctx)
    expect(sdk.createSession).not.toHaveBeenCalled()
    expect(r.report.reviewer).toBe('rules')
    expect(r.report.unknowns.join(' ')).toContain('Droid is not set up')
  })
})

describe('rules from the inspector', () => {
  const outputs = (findings: unknown[]): Map<string, string> =>
    new Map([['review_c_cpp', result('c', findings)]])

  it('keep weaknesses together and below Suspicious, however many there are', () => {
    const weak = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) =>
      finding(`c_${c}`, 'critical', 'vulnerability', `Weakness ${c}`)
    )
    const reasons = rulesToReasons(ruleFindings(outputs(weak)), 0)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({ code: 'vulnerabilities', weight: VULNERABILITY_CAP })
    expect(combine(reasons).verdict).toBe('clean')
  })

  it('carry hard rules, and keep the most severe finding per code', () => {
    const hard = {
      ...(finding(
        'sh_download_exec',
        'critical',
        'malware',
        'Downloads a script and runs it',
        2
      ) as object),
      hard: true
    }
    const rules = ruleFindings(
      new Map([
        [
          'review_shell',
          result('shell', [hard, finding('sh_download_exec', 'low', 'malware', 'x', 5)])
        ]
      ])
    )
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ severity: 'critical', hard: true, lines: [2, 5] })
    expect(combine(rulesToReasons(rules, 0)).verdict).toBe('malicious')
  })

  it("don't count a strings hit twice when the file's own check already scored it", () => {
    const rules = ruleFindings(
      new Map([
        [
          'review_shell',
          result('shell', [
            finding('sh_persistence', 'high', 'malware', 'Sets itself to start at login', 3)
          ])
        ],
        [
          'extract_strings',
          result('strings', [
            finding('persistence_strings', 'high', 'malware', 'Mentions an autostart location'),
            finding('crypto_mining', 'high', 'malware', 'Cryptocurrency mining')
          ])
        ]
      ])
    )
    expect(rulesToReasons(rules, 0).map((r) => r.code)).toEqual(['sh_persistence', 'crypto_mining'])
    // Alone, the strings hit still counts.
    const alone = ruleFindings(
      new Map([
        [
          'extract_strings',
          result('strings', [finding('persistence_strings', 'high', 'malware', 'x')])
        ]
      ])
    )
    expect(rulesToReasons(alone, 0).map((r) => r.code)).toEqual(['persistence_strings'])
  })

  it('count network attempts the findings do not explain', () => {
    expect(rulesToReasons([], 2).map((r) => r.code)).toEqual(['network_attempt'])
    const explained = ruleFindings(
      outputs([finding('sh_download_exec', 'critical', 'malware', 'Downloads')])
    )
    expect(rulesToReasons(explained, 2).map((r) => r.code)).toEqual(['sh_download_exec'])
  })
})
