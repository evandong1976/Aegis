// Create a shell file on this Mac, show it, and run it inside a network-off Daytona sandbox
// (feature/sandbox). The shell file is a harmless test sample that only *looks* malicious: it
// tries to download and run a second stage, writes a LaunchAgent, decodes base64 into a shell,
// and looks for Chrome's saved passwords and the keychain. Every one of those is fake or blocked:
//
// - it does nothing at all unless AEGIS_SANDBOX=1, which only the sandbox run sets;
// - its downloads point at `.invalid` hosts, which never resolve, and the sandbox has no network;
// - its $HOME inside the sandbox is a scratch folder, and its base64 payload is an `echo`.
//
// On the Mac the file is written without execute permission and never run (MEGA_PROMPT §6 rule 1).
//
//   pnpm try:sandbox
//
// Needs DAYTONA_API_KEY in .env.local or .env. Optional: AEGIS_DAYTONA_SNAPSHOT (without it
// Daytona uses its default snapshot). Writes the sample and the run's evidence to
// logs/<date-time>-sandbox-run/ and exits 1 if any step fails.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Daytona } from '@daytona/sdk'
import {
  RUN_TIMEOUT_S,
  runSample,
  withSandbox,
  type Observation,
  type SandboxClient
} from '../src/main/daytona.ts'
import { FAKE_INSTALLER as SAMPLE } from '../src/main/testSamples.ts'

const SAMPLE_NAME = 'zoom-update.sh'

const stamp = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

if (!process.env.DAYTONA_API_KEY) {
  console.error('DAYTONA_API_KEY is not set. Add it to .env.local (Daytona dashboard › API keys).')
  process.exit(1)
}

const outDir = join('logs', `${stamp()}-sandbox-run`)
const failures: string[] = []
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// 1. Create the shell file on this Mac, read-write only (no execute bit), and show it.
await mkdir(join(outDir, 'sample'), { recursive: true })
const samplePath = join(outDir, 'sample', SAMPLE_NAME)
await writeFile(samplePath, SAMPLE, { mode: 0o644 })
const bytes = await readFile(samplePath)
console.log(`\nCreated ${samplePath} (${bytes.length} bytes, not executable, never run here):\n`)
console.log(
  SAMPLE.split('\n')
    .map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)
    .join('\n')
)

// 2–4. Network-off sandbox → upload → prove the network is off → run the sample → delete.
console.log('\nSandbox:')
const snapshot = process.env.AEGIS_DAYTONA_SNAPSHOT || undefined
const outcome = await withSandbox(
  new Daytona() as unknown as SandboxClient,
  { labels: { job: 'try-sandbox' }, snapshot },
  async (session) => {
    console.log(`  created ${session.id} with the network off`)
    const meta = await session.upload(bytes, {
      filename: SAMPLE_NAME,
      url: null,
      referrer: null,
      contentType: 'text/x-shellscript'
    })
    console.log(`  uploaded ${SAMPLE_NAME}; SHA-256 checked inside the sandbox (${meta.sha256})`)
    const off = await session.networkIsOff()
    console.log(`  network probe: ${off ? 'off' : 'ON'}`)
    if (!off) throw new Error('the sandbox can reach the network; not running the sample')
    console.log(`  running it (limit ${RUN_TIMEOUT_S} s)…`)
    return { meta, networkOff: off, observation: await runSample(session) }
  }
)

for (const e of outcome.log) {
  console.log(
    `  ${e.at}  ${e.ok ? 'ok  ' : 'FAIL'} ${e.step.padEnd(36)} ${String(e.ms).padStart(6)} ms  ${e.detail}`
  )
}

const obs: Observation | undefined = outcome.result?.observation
if (obs) {
  console.log('\nWhat it did inside the sandbox:')
  console.log(`  exit code ${obs.exitCode}${obs.timedOut ? ' (ran out of time)' : ''}`)
  console.log(`  commands run (${obs.commands.length}):`)
  for (const c of obs.commands) console.log(`    $ ${c}`)
  console.log(`  files written (${obs.filesWritten.length}):`)
  for (const f of obs.filesWritten) console.log(`    ${f}`)
  console.log(`  network attempts, all blocked (${obs.networkAttempts.length}):`)
  for (const n of obs.networkAttempts) console.log(`    ${n}`)
  console.log(`  output:\n${obs.stdout.replace(/^/gm, '    | ')}`)
}

console.log('\nChecks:')
check(!outcome.error, outcome.error ? `sandbox job: ${outcome.error}` : 'sandbox job finished')
check(outcome.result?.networkOff === true, 'network was off before the sample ran')
check(!!obs && !obs.timedOut, 'sample ran to the end inside the time limit')
check(
  !!obs && obs.stdout.includes('Installing Zoom update'),
  'sample ran in sandbox mode (AEGIS_SANDBOX=1)'
)
check(
  !!obs && obs.filesWritten.some((f) => f.includes('Library/LaunchAgents/')),
  'the LaunchAgent write was recorded'
)
check(!!obs && obs.networkAttempts.length >= 2, 'the download attempts were recorded')
check(outcome.deleted, 'sandbox deleted')

await writeFile(
  join(outDir, 'run.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      sample: { path: samplePath, ...(outcome.result?.meta ?? {}) },
      snapshot: snapshot ?? 'default',
      error: outcome.error ?? null,
      deleted: outcome.deleted,
      sandboxLog: outcome.log,
      observation: obs ?? null,
      failures
    },
    null,
    2
  ) + '\n'
)
console.log(`\nEvidence: ${outDir}/run.json`)

process.exit(failures.length ? 1 : 0)
