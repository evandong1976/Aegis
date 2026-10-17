// Smallest working Factory Droid calls (BUILD_PROMPT §4.5, §4.7):
//
// 1. `run()`: one prompt, structured JSON output, nothing allowed to touch this Mac.
// 2. The Worker A shape to test (docs/PLAN.md › Sponsor findings): Droid runs here with every
//    built-in tool switched off, and its only tool is an in-process MCP tool. In Aegis that tool
//    would run read-only commands inside the Daytona sandbox. Here it returns a fixed line of
//    analysis output, so this script needs no sandbox and no sample.
//
//   pnpm try:droid
//
// Needs FACTORY_API_KEY in .env and the droid CLI on PATH (`brew install --cask droid`, or
// `npm install -g droid@<version>`), or DROID_PATH pointing at it. Exits 1 if any check fails.

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AutonomyLevel,
  DroidMessageType,
  OutputFormatType,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  createSdkMcpServer,
  createSession,
  run,
  tool
} from '@factory/droid-sdk/node'

const results: Array<{ step: string; ok: boolean; detail: string }> = []
const record = (step: string, ok: boolean, detail: string): void => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}: ${detail}`)
}
const seconds = (since: number): string => `${((performance.now() - since) / 1000).toFixed(1)} s`
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

if (!process.env.FACTORY_API_KEY) {
  console.error('FACTORY_API_KEY is not set. Add it to .env (Factory app › Settings › API keys).')
  process.exit(1)
}
const execPath = process.env.DROID_PATH || 'droid'
try {
  const version = execFileSync(execPath, ['--version'], { encoding: 'utf8', timeout: 15_000 })
  record('droid CLI', true, `${execPath} ${version.trim()}`)
} catch {
  console.error(
    `No droid CLI at "${execPath}". Install it (brew install --cask droid, or npm install -g droid@<version>) or set DROID_PATH.`
  )
  process.exit(1)
}

// An empty working directory, so even a misbehaving run has nothing of ours to read.
const cwd = await mkdtemp(join(tmpdir(), 'aegis-try-droid-'))
const VERDICTS = ['malicious', 'suspicious', 'unknown', 'clean']

try {
  // 1. One-shot run with structured output. No permission handler: any tool request is cancelled.
  const t1 = performance.now()
  const one = await run(
    'You are checking a setup. Reply with verdict "unknown" and a one-sentence summary saying the check worked.',
    {
      cwd,
      execPath,
      autonomyLevel: AutonomyLevel.Off,
      autoRejectPermissionRequests: true,
      outputFormat: {
        type: OutputFormatType.JsonSchema,
        schema: {
          type: 'object',
          properties: { verdict: { type: 'string', enum: VERDICTS }, summary: { type: 'string' } },
          required: ['verdict', 'summary'],
          additionalProperties: false
        }
      }
    }
  )
  const out = one.structuredOutput as { verdict?: string; summary?: string } | undefined
  record(
    'run() with structured output',
    one.success && typeof out?.verdict === 'string' && VERDICTS.includes(out.verdict),
    one.success
      ? `${JSON.stringify(out)} in ${seconds(t1)}`
      : `${one.subtype}: ${one.structuredOutputError?.message ?? one.error?.message ?? 'no detail'}`
  )

  // 2. Built-in tools off; the only tool is ours.
  const SERVER = 'aegis-sandbox'
  let toolCalls = 0
  const sandboxTools = createSdkMcpServer({
    name: SERVER,
    tools: [
      tool(
        'sample_strings',
        'Returns `strings` output for the sample in the sandbox. Read-only.',
        () => {
          toolCalls += 1
          return 'note.txt: "Aegis try-droid: harmless text, nothing to run."'
        }
      )
    ]
  })
  const session = await createSession({
    cwd,
    execPath,
    autonomyLevel: AutonomyLevel.Off,
    mcpServers: [sandboxTools],
    // Allow only our server's tools; cancel everything else.
    permissionHandler: ({ toolUses }) =>
      toolUses.length > 0 &&
      toolUses.every(
        (u) => u.details.type === ToolConfirmationType.McpTool && u.details.serverName === SERVER
      )
        ? ToolConfirmationOutcome.ProceedOnce
        : ToolConfirmationOutcome.Cancel
  })
  try {
    const builtIn = await session.listTools()
    await session.updateSettings({ disabledToolIds: builtIn.map((t) => t.id) })
    const stillOn = (await session.listTools()).filter((t) => t.allowed).map((t) => t.id)
    record(
      'built-in tools off',
      stillOn.length === 0,
      stillOn.length === 0
        ? `${builtIn.length} switched off (${builtIn.map((t) => t.id).join(', ')})`
        : `still allowed: ${stillOn.join(', ')}`
    )

    const t2 = performance.now()
    let finalText = ''
    let ok = false
    let failure = ''
    for await (const m of session.stream(
      'Call the sample_strings tool once, then reply with one sentence describing what it returned.'
    )) {
      if (m.type === DroidMessageType.Assistant) finalText = m.text
      if (m.type === DroidMessageType.Result) {
        ok = m.success
        failure = m.error?.message ?? m.subtype
      }
    }
    record(
      'only our MCP tool',
      ok && toolCalls > 0,
      ok
        ? `${toolCalls} call(s) to ${SERVER}/sample_strings in ${seconds(t2)}; "${finalText.trim()}"`
        : failure
    )
  } finally {
    await session.close()
  }
} catch (err) {
  record('Droid call', false, message(err))
} finally {
  await rm(cwd, { recursive: true, force: true })
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
