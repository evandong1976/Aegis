// Worker A: Droid as the analyst (PLAN.md decision 19, milestone 4). Droid runs on this Mac with
// every built-in tool switched off. Its only tools are the fixed, read-only commands
// droidToolkit.ts chose for the file's type, run inside the network-off sandbox, and every session
// carries the file-type reference in its system prompt (droidBrief.ts). It implements `LiveAgent`,
// so the live view shows the real session; index.ts uses the same agent for downloads.
//
// Droid's answer is checked, never trusted:
// - The rules come from the inspector's own findings (sandbox/aegis_inspect.py), not from Droid.
//   Every check for the file's type runs, even the ones Droid skips, so a sample that talks Droid
//   out of a tool still meets it. Droid's verdict can only raise the rules' (verdict.ts).
// - Line numbers Droid cites are looked up in the file; the code shown is the file's, not Droid's.
// - A SHA-256 that doesn't match, or a tool cited but never called, lowers confidence and says so.
// If Droid can't run or doesn't finish, the report says so and the rules decide alone.
//
// No `@shared` runtime imports and `.ts` extensions on local imports: scripts/try-analyst.mts runs
// this file directly under Node.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { CodeExcerpt, Finding, Reason, Severity, TimelineStep, Verdict } from '@shared/types'
import type { AgentContext, AgentResult, LiveAgent } from './liveAgent'
import { ANALYST_ROLE, ANALYST_SCHEMA, analystPrompt, droidSystemPrompt } from './droidBrief.ts'
import {
  BASELINE_SKIP,
  SANDBOX_SERVER,
  allowOnlySandboxTools,
  builtInToolIds,
  directToolCalls,
  fenceToolOutput,
  toolsStillOn
} from './droidLockdown.ts'
import { parseInspectorResult, withoutResultLine, type InspectorFinding } from './fileTypes.ts'

type Sdk = typeof import('@factory/droid-sdk/node')
/** The parts of @factory/droid-sdk this module uses; tests pass a fake. */
export type DroidSdk = Pick<
  Sdk,
  | 'createSession'
  | 'createSdkMcpServer'
  | 'tool'
  | 'AutonomyLevel'
  | 'OutputFormatType'
  | 'ProcessTransport'
>

export interface DroidAgentOptions {
  /** The droid CLI, or null when it isn't set up: the rules then decide alone. */
  execPath: string | null
  apiKey?: string
  /** resources/droid/file_types_vulnerabilities.md, sent with every session. */
  reference: string
  sdk?: DroidSdk
  modelId?: string
  timeoutMs?: number
}

/** How long Droid gets for one file before it is interrupted. */
export const DROID_TIMEOUT_MS = 150_000

// ── Rules from the inspector's findings ─────────────────────────────────────────────────────────

/** Points per malware sign, by severity. */
export const MALWARE_WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 3
}
/** Points per weakness, by severity, before the cap. */
export const VULNERABILITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0
}
/**
 * Weaknesses together add at most this, below Suspicious (30): a vulnerable file is not malware by
 * itself (the reference). Droid can still raise it, with evidence.
 */
export const VULNERABILITY_CAP = 25

const SEVERITY_RANK: Severity[] = ['low', 'medium', 'high', 'critical']
const NETWORK_CODES = /download|sends|exfil|network|url|reverse_shell|remote/

interface RuleFinding extends InspectorFinding {
  tool: string
  /** Every line the inspector flagged for this code. */
  lines: number[]
}

/** The inspector's findings across every tool output, one per code (the most severe). */
export function ruleFindings(outputs: ReadonlyMap<string, string>): RuleFinding[] {
  const byCode = new Map<string, RuleFinding>()
  for (const [tool, output] of outputs) {
    for (const f of parseInspectorResult(output)?.findings ?? []) {
      const seen = byCode.get(f.code)
      const lines = [...(seen?.lines ?? []), ...(f.line ? [f.line] : [])]
      if (!seen || SEVERITY_RANK.indexOf(f.severity) > SEVERITY_RANK.indexOf(seen.severity)) {
        byCode.set(f.code, { ...f, tool, lines })
      } else {
        seen.lines = lines
        seen.hard ||= f.hard
      }
    }
  }
  return [...byCode.values()].sort(
    (a, b) => SEVERITY_RANK.indexOf(b.severity) - SEVERITY_RANK.indexOf(a.severity)
  )
}

const lowerFirst = (s: string): string =>
  /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s

/** Reasons for verdict.ts: each malware sign, the weaknesses together, unexplained network use. */
/**
 * What the strings check finds that a check for the file's type may already have scored: the
 * strings finding then adds nothing, so the same act isn't counted twice.
 */
const STRING_TWINS: Readonly<Record<string, RegExp>> = {
  persistence_strings: /persistence/,
  credential_strings: /credential/,
  download_strings: /download/,
  shell_strings: /download_exec|_command$|shell|script_host/,
  keylogging_strings: /keylog|api_keylogging/,
  evasion_strings: /anti_debug/,
  crypto_mining: /mining/
}

export function rulesToReasons(rules: RuleFinding[], networkAttempts: number): Reason[] {
  const scored = rules.filter((r) => r.kind === 'malware')
  const malware = scored.filter(
    (r) =>
      !STRING_TWINS[r.code] ||
      !scored.some((o) => o.code !== r.code && STRING_TWINS[r.code].test(o.code))
  )
  const weak = rules.filter((r) => r.kind === 'vulnerability')
  const reasons: Reason[] = malware.map((r) => ({
    code: r.code,
    text: lowerFirst(r.title),
    weight: MALWARE_WEIGHT[r.severity],
    hard: r.hard
  }))
  if (weak.length) {
    const sum = weak.reduce((n, r) => n + VULNERABILITY_WEIGHT[r.severity], 0)
    const top = weak.slice(0, 2).map((r) => lowerFirst(r.title))
    reasons.push({
      code: 'vulnerabilities',
      text: `${weak.length === 1 ? 'has a weakness' : `has ${weak.length} weaknesses`}: ${top.join('; ')}`,
      weight: Math.min(VULNERABILITY_CAP, sum),
      hard: false
    })
  }
  if (networkAttempts > 0 && !malware.some((r) => NETWORK_CODES.test(r.code))) {
    reasons.push({
      code: 'network_attempt',
      text: 'tries to reach the internet',
      weight: 15,
      hard: false
    })
  }
  return reasons
}

// ── Droid's answer ───────────────────────────────────────────────────────────────────────────────

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const Text = (n: number): z.ZodType<string> => z.string().transform((s) => clip(s.trim(), n))
const Line = z.number().int().positive().nullable().catch(null)
const each = <T>(schema: z.ZodType<T>, max: number): z.ZodType<T[]> =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items
        .flatMap((i) => {
          const r = schema.safeParse(i)
          return r.success ? [r.data] : []
        })
        .slice(0, max)
    )

const AnswerFinding = z.object({
  kind: z.enum(['malware', 'vulnerability']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: Text(160),
  detail: Text(600),
  tool: Text(60).catch(''),
  ruleCode: z.string().nullable().catch(null),
  line: Line,
  code: z.string().nullable().catch(null)
})
const AnswerStep = z.object({
  tone: z.enum(['danger', 'warning']),
  title: Text(160),
  detail: Text(600),
  line: Line
})
export const AnswerSchema = z.object({
  verdict: z.enum(['malicious', 'suspicious', 'unknown', 'clean']),
  summary: Text(300),
  confidence: z.enum(['low', 'medium', 'high']).catch('low'),
  sha256: z.string().catch(''),
  detectedType: Text(120).catch(''),
  referenceRows: each(Text(40), 16),
  methods: each(Text(160), 16),
  findings: each(AnswerFinding, 40),
  timeline: each(AnswerStep, 12),
  capabilities: each(Text(40), 8),
  unknowns: each(Text(300), 8)
})
export type Answer = z.infer<typeof AnswerSchema>

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The first few lines of a tool's output, for the live view. */
function excerpt(output: string, lines = 4, chars = 320): string {
  const head = output.split('\n').slice(0, lines).join('\n')
  return head.length > chars ? `${head.slice(0, chars)}…` : head
}

/** The file's text from read_sample, or null if it isn't text. */
function sourceText(outputs: ReadonlyMap<string, string>): string | null {
  const text = outputs.get('read_sample')
  if (!text) return null
  const head = text.slice(0, 8192)
  // eslint-disable-next-line no-control-regex
  const odd = (head.match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length
  return head.includes('\u0000') || odd > head.length * 0.05 ? null : text
}

// ── The agent ────────────────────────────────────────────────────────────────────────────────────

export function droidAgent(opts: DroidAgentOptions): LiveAgent {
  return {
    info: { name: 'Droid', mode: 'droid', where: 'mac' },
    async review(ctx) {
      const outputs = new Map<string, string>()
      const say = (text: string): void => ctx.emit({ kind: 'agent', step: 'thought', text })

      const call = async (name: string): Promise<string> => {
        const spec = ctx.tools.find((t) => t.name === name)
        if (!spec) return `There is no tool named ${name}.`
        ctx.emit({
          kind: 'agent',
          step: 'tool',
          tool: name,
          command: spec.command,
          text: spec.description
        })
        try {
          const res = await ctx.runTool(name)
          outputs.set(name, res.output)
          ctx.emit({
            kind: 'agent',
            step: 'result',
            tool: name,
            exitCode: res.exitCode,
            bytes: Buffer.byteLength(res.output),
            text: excerpt(withoutResultLine(res.output))
          })
          return res.output
        } catch (err) {
          ctx.emit({
            kind: 'agent',
            step: 'result',
            tool: name,
            exitCode: -1,
            bytes: 0,
            text: message(err)
          })
          return `The tool failed: ${message(err)}`
        }
      }

      const families = ctx.match?.families.length
        ? ctx.match.families.join(', ')
        : 'no reference row'
      say(
        `I'm Droid, on this Mac. ${ctx.filename} is in a Daytona sandbox with no network; I reach it through ${ctx.tools.length} read-only tools chosen for its type (${families}).`
      )

      let answer: Answer | null = null
      let failure = ''
      if (!opts.execPath) {
        failure = 'Droid is not set up on this Mac'
      } else {
        try {
          answer = await askDroid(opts, opts.execPath, ctx, say, call)
        } catch (err) {
          failure = message(err)
          say(`I couldn't finish: ${failure}. Aegis's own checks decide this one.`)
        }
      }

      // Every check for the file's type runs, whatever Droid chose.
      const skipped = ctx.tools.filter(
        (t) =>
          !outputs.has(t.name) &&
          (t.name === 'describe_sample' ||
            t.name === 'read_sample' ||
            (t.check && !BASELINE_SKIP.includes(t.check)))
      )
      if (skipped.length) {
        say(
          `Aegis also runs ${skipped.map((t) => t.name).join(', ')}, so its rules see every check for this type.`
        )
        for (const t of skipped) await call(t.name)
      }

      const result = buildResult(
        ctx,
        outputs,
        answer,
        failure,
        skipped.map((t) => t.name)
      )
      ctx.emit({
        kind: 'agent',
        step: 'verdict',
        verdict: result.report.verdict,
        text: result.report.summary
      })
      return result
    }
  }
}

async function askDroid(
  opts: DroidAgentOptions,
  execPath: string,
  ctx: AgentContext,
  say: (text: string) => void,
  call: (name: string) => Promise<string>
): Promise<Answer> {
  const sdk = opts.sdk ?? (await import('@factory/droid-sdk/node'))
  const apiKey = opts.apiKey ?? process.env.FACTORY_API_KEY
  if (!apiKey) throw new Error('FACTORY_API_KEY is not set')
  // An empty working directory: even a misbehaving session has nothing of ours to read.
  const cwd = await mkdtemp(join(tmpdir(), 'aegis-droid-'))
  // The droid process, started here rather than by createSession so that its sessions ask for
  // direct tool calls (droidLockdown.ts › TOOL_EXECUTION_MODE).
  const droidProcess = new sdk.ProcessTransport({
    droidExecPath: execPath,
    cwd,
    env: { FACTORY_API_KEY: apiKey, FACTORY_UPSTREAM_CLIENT_TYPE: 'sdk' }
  })
  const server = sdk.createSdkMcpServer({
    name: SANDBOX_SERVER,
    tools: ctx.tools.map((spec) =>
      sdk.tool(spec.name, spec.description, async () =>
        fenceToolOutput(withoutResultLine(await call(spec.name)))
      )
    )
  })
  let session: Awaited<ReturnType<Sdk['createSession']>> | undefined
  let interruptTimer: NodeJS.Timeout | undefined
  let deadlineTimer: NodeJS.Timeout | undefined
  const timeoutMs = opts.timeoutMs ?? DROID_TIMEOUT_MS
  try {
    // As in scripts/try-droid.mts: the SDK marks its own server `oauth: false`, which the droid
    // CLI only accepts at the SDK's exact protocol version, so pass it as a plain HTTP config.
    const { oauth: _sdkOAuthOptOut, ...toolServer } = await server.start()
    void _sdkOAuthOptOut
    await droidProcess.connect()
    session = await sdk.createSession({
      cwd,
      transport: directToolCalls(droidProcess),
      autonomyLevel: sdk.AutonomyLevel.Off,
      mcpServers: [toolServer],
      permissionHandler: allowOnlySandboxTools,
      systemPrompt: droidSystemPrompt(opts.reference, ANALYST_ROLE),
      disableBuiltinSkills: true,
      ...(opts.modelId ? { modelId: opts.modelId } : {})
    })
    const s = session
    await s.updateSettings({ disabledToolIds: builtInToolIds(await s.listTools()) })
    const stillOn = toolsStillOn(await s.listTools())
    if (stillOn.length) {
      throw new Error(`built-in tools stayed on (${stillOn.join(', ')}), so Droid was not run`)
    }
    const prompt = analystPrompt({
      filename: ctx.filename,
      size: ctx.meta.size,
      sha256: ctx.meta.sha256,
      match: ctx.match ?? {
        ext: '',
        claimed: null,
        detected: null,
        label: 'not identified',
        families: [],
        rows: [],
        mismatch: false
      },
      tools: ctx.tools,
      run: ctx.observation
    })
    let last: { success: boolean; structuredOutput?: unknown; error: string } | null = null
    const consume = async (): Promise<void> => {
      for await (const m of s.stream(prompt, {
        outputFormat: { type: sdk.OutputFormatType.JsonSchema, schema: ANALYST_SCHEMA }
      })) {
        if (m.type === 'assistant') {
          const text = m.text.trim()
          if (text && !text.startsWith('{')) say(clip(text, 400))
        } else if (m.type === 'result') {
          last = {
            success: m.success,
            structuredOutput: m.structuredOutput,
            error: m.error?.message ?? m.structuredOutputError?.message ?? m.subtype
          }
        }
      }
    }
    let timedOut = false
    interruptTimer = setTimeout(() => {
      timedOut = true
      void s.interrupt().catch(() => undefined)
    }, timeoutMs)
    await Promise.race([
      consume(),
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(
          () => reject(new Error('the session stopped answering')),
          timeoutMs + 15_000
        )
      })
    ])
    const done = last as { success: boolean; structuredOutput?: unknown; error: string } | null
    if (timedOut) throw new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)
    if (!done) throw new Error('the session ended without a result')
    if (!done.success) throw new Error(done.error)
    const parsed = AnswerSchema.safeParse(done.structuredOutput)
    if (!parsed.success) {
      throw new Error(
        `its answer didn't match the schema (${parsed.error.issues[0]?.message ?? 'invalid'})`
      )
    }
    return parsed.data
  } finally {
    clearTimeout(interruptTimer)
    clearTimeout(deadlineTimer)
    await session?.close().catch(() => undefined)
    await droidProcess.close().catch(() => undefined)
    await server.close().catch(() => undefined)
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ── The result ───────────────────────────────────────────────────────────────────────────────────

const KIND_LABEL = { malware: 'Malware sign', vulnerability: 'Vulnerability' } as const

/** Turns the tool outputs and Droid's answer (or its absence) into the agent's result. */
export function buildResult(
  ctx: AgentContext,
  outputs: ReadonlyMap<string, string>,
  answer: Answer | null,
  failure: string,
  ranByAegis: string[] = []
): AgentResult {
  const path = ctx.meta.filename
  const source = sourceText(outputs)
  const sourceLines = source?.split('\n') ?? []
  const lineAt = (n: number | null): string | null =>
    n && n <= sourceLines.length ? sourceLines[n - 1].trim().slice(0, 300) : null

  const rules = ruleFindings(outputs)
  const reasons = rulesToReasons(rules, ctx.observation?.networkAttempts.length ?? 0)
  const confirmed = new Set((answer?.findings ?? []).map((f) => f.ruleCode).filter(Boolean))

  const ruleSeverity = new Map(rules.map((r) => [r.code, r.severity]))
  const droidFindings: Finding[] = (answer?.findings ?? []).map((f) => {
    const code = lineAt(f.line)
    // Droid can raise a finding it confirms, never lower it.
    const floor = f.ruleCode ? ruleSeverity.get(f.ruleCode) : undefined
    return {
      severity:
        floor && SEVERITY_RANK.indexOf(floor) > SEVERITY_RANK.indexOf(f.severity)
          ? floor
          : f.severity,
      title: f.title,
      detail: `${KIND_LABEL[f.kind]}. ${f.detail}${f.tool ? ` (Droid, from ${f.tool})` : ' (Droid)'}`,
      evidence: code
        ? { path, line: f.line ?? undefined, code }
        : f.code
          ? { path, code: clip(f.code, 300) }
          : undefined
    }
  })
  const aegisFindings: Finding[] = rules
    .filter((r) => !confirmed.has(r.code))
    .map((r) => ({
      severity: r.severity,
      title: r.title,
      detail: `${KIND_LABEL[r.kind]}. ${r.detail ? `${r.detail}. ` : ''}(Aegis check ${r.code}, from ${r.tool})`,
      evidence: r.line
        ? { path, line: r.line, code: lineAt(r.line) ?? r.evidence ?? '' }
        : r.evidence
          ? { path, code: r.evidence }
          : undefined
    }))

  const described = outputs.get('describe_sample')
  const intact = described === undefined || described.includes(ctx.meta.sha256)
  const sameFile = !answer || answer.sha256.trim().toLowerCase() === ctx.meta.sha256
  const cited = (answer?.findings ?? []).map((f) => f.tool).filter((t) => t && !outputs.has(t))
  const unknowns = [
    ...(answer?.unknowns ?? []),
    ...(ctx.notes ?? []),
    ...(failure
      ? [
          `Droid couldn't finish (${failure}). The verdict comes from Aegis's own checks for this file type.`
        ]
      : []),
    ...(intact
      ? []
      : [
          'The file in the sandbox no longer matched the download when it was reviewed, so what was read may not be what was caught.'
        ]),
    ...(sameFile
      ? []
      : [
          `Droid reported a different SHA-256 (${answer?.sha256.slice(0, 12)}…), so its reading may not be of this file.`
        ]),
    ...(cited.length ? [`Droid cited ${[...new Set(cited)].join(', ')} without calling it.`] : []),
    ...(answer && ranByAegis.length
      ? [`Droid skipped ${ranByAegis.join(', ')}; Aegis ran them for its rules.`]
      : [])
  ]

  const timeline: TimelineStep[] = answer
    ? answer.timeline.map((t, i) => {
        const code = lineAt(t.line)
        return {
          step: i + 1,
          tone: t.tone,
          title: t.title,
          detail: t.detail,
          evidence: code && t.line ? [{ path, line: t.line, code }] : []
        }
      })
    : rules
        .filter((r) => r.kind === 'malware')
        .slice(0, 8)
        .map((r, i) => ({
          step: i + 1,
          tone: r.severity === 'critical' || r.severity === 'high' ? 'danger' : 'warning',
          title: r.title,
          detail: r.detail || `Found by Aegis's ${r.tool} check.`,
          evidence: r.lines
            .slice(0, 3)
            .map((n) => ({ path, line: n, code: lineAt(n) ?? r.evidence ?? '' }))
        }))

  const flagged = new Map<number, { title: string; severity: Severity }>()
  for (const r of rules)
    for (const n of r.lines) flagged.set(n, { title: r.title, severity: r.severity })
  for (const f of answer?.findings ?? [])
    if (f.line) flagged.set(f.line, { title: f.title, severity: f.severity })
  const code: CodeExcerpt[] = source?.trim()
    ? [
        {
          path,
          origin: 'read inside the sandbox',
          startLine: 1,
          lines: sourceLines.slice(0, 60),
          flags: [...flagged].filter(([n]) => n <= 60).map(([line, f]) => ({ line, ...f }))
        }
      ]
    : []

  const malwareTitles = rules.filter((r) => r.kind === 'malware').map((r) => r.title)
  const capabilities = answer?.capabilities.length
    ? answer.capabilities
    : [...new Set(malwareTitles)].slice(0, 6)
  const summary =
    answer?.summary ||
    (rules.length
      ? `Aegis's checks found: ${rules
          .slice(0, 3)
          .map((r) => lowerFirst(r.title))
          .join('; ')}.`
      : "Aegis's checks for this file type found nothing; Droid did not review it.")
  const verdict: Verdict = answer?.verdict ?? 'unknown'
  const confidence = answer && intact && sameFile ? answer.confidence : 'low'
  return {
    report: {
      timeline,
      verdict,
      summary,
      confidence,
      unknowns: unknowns.map((u) => clip(u, 300)),
      reviewer: answer ? 'droid' : 'rules'
    },
    reasons,
    findings: [...droidFindings, ...aegisFindings],
    capabilities,
    code
  }
}
