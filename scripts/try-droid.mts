// Smallest working Factory Droid calls (BUILD_PROMPT §4.5, §4.7):
//
// 1. `run()`: one prompt, structured JSON output, nothing allowed to touch this Mac.
// 2. Worker A option B, "connected" (docs/PLAN.md › Sponsor findings): Droid runs here with every
//    built-in tool switched off, and its only tool is an in-process MCP tool. In Aegis that tool
//    would run read-only commands inside the Daytona sandbox. Here it returns a fixed line of
//    analysis output, so this step needs no sandbox and no sample.
// 3. Worker A option A, "inside": the same kind of call from inside a Daytona sandbox. It installs
//    the droid CLI there and runs `droid exec` (read-only by default). No sample is involved, so
//    the sandbox has the network it needs to install the CLI. If AEGIS_FACTORY_DOMAINS is set
//    (comma-separated hosts), the network is then cut to those hosts before the call, to test
//    whether Droid works with only Factory reachable. The FACTORY_API_KEY is passed to the
//    sandbox for that one command, and the sandbox is deleted in a `finally`.
//
//   pnpm try:droid
//
// Needs FACTORY_API_KEY and DAYTONA_API_KEY in .env, and the droid CLI on PATH
// (`brew install --cask droid`, or `npm install -g droid@<version>`) or DROID_PATH pointing at
// it. Exits 1 if any check fails.

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
import { Daytona, type Sandbox } from '@daytona/sdk'

/** The droid CLI version installed in the sandbox: exact, and at least two weeks old when pinned. */
const SANDBOX_DROID_VERSION = '0.232.0'

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

// 3. Inside a Daytona sandbox.
if (!process.env.DAYTONA_API_KEY) {
  record('droid inside a Daytona sandbox', false, 'needs DAYTONA_API_KEY in .env')
} else {
  let sandbox: Sandbox | undefined
  try {
    const t3 = performance.now()
    const box = await new Daytona().create(
      {
        snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || undefined,
        ephemeral: true,
        autoStopInterval: 10,
        labels: { app: 'aegis', job: 'try-droid' }
      },
      { timeout: 20 }
    )
    sandbox = box
    type Run = ReturnType<Sandbox['process']['executeCommand']>
    const sh = (cmd: string, timeout: number, env?: Record<string, string>): Run =>
      box.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
    const hasNpm = (await sh('command -v npm', 15)).exitCode === 0
    const install = hasNpm
      ? `npm install -g droid@${SANDBOX_DROID_VERSION}`
      : 'curl -fsSL https://app.factory.ai/cli | sh'
    const installed = await sh(
      `${install} && export PATH="$HOME/.local/bin:$PATH" && droid --version`,
      300
    )
    record(
      'droid CLI in the sandbox',
      installed.exitCode === 0,
      `${box.id}: "${install}" exit ${installed.exitCode}; ${installed.result.trim().split('\n').pop()} (${seconds(t3)} incl. start)`
    )

    const domains = process.env.AEGIS_FACTORY_DOMAINS
    if (domains) await box.updateNetworkSettings({ domainAllowList: domains })
    const t4 = performance.now()
    const prompt = 'Reply with exactly one sentence saying this check worked. Do not use any tools.'
    const ran = await sh(
      `export PATH="$HOME/.local/bin:$PATH" && droid exec --output-format json "${prompt}"`,
      120,
      { FACTORY_API_KEY: process.env.FACTORY_API_KEY ?? '' }
    )
    const network = domains ? `network limited to ${domains}` : 'network open'
    record(
      'droid exec inside the sandbox',
      ran.exitCode === 0 && ran.result.trim().length > 0,
      `exit ${ran.exitCode} in ${seconds(t4)}, ${network}; ${ran.result.trim().slice(0, 300)}`
    )
  } catch (err) {
    record('droid inside a Daytona sandbox', false, message(err))
  } finally {
    if (sandbox) {
      try {
        await sandbox.delete(60)
        record('delete', true, `${sandbox.id} at ${new Date().toISOString()}`)
      } catch (err) {
        record('delete', false, `${sandbox.id}: ${message(err)}`)
      }
    }
  }
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
