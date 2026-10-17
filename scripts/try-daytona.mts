// Smallest working Daytona call (BUILD_PROMPT §4.5): create a sandbox with the network off, upload
// a file, run a command on it, check the network really is off, and delete the sandbox in a
// `finally`. Prints each step's timing for docs/PLAN.md › Sponsor findings.
//
//   pnpm try:daytona
//
// Needs DAYTONA_API_KEY in .env.local or .env. Optional: DAYTONA_API_URL, DAYTONA_TARGET (read by the SDK) and
// AEGIS_DAYTONA_SNAPSHOT (a snapshot name; without it Daytona uses its default snapshot).
// Exits 1 if any check fails. The file it uploads is a line of text, nothing else.

import { createHash } from 'node:crypto'
import { Daytona, type Sandbox } from '@daytona/sdk'

const results: Array<{ step: string; ok: boolean; detail: string }> = []
const record = (step: string, ok: boolean, detail: string): void => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}: ${detail}`)
}
const seconds = (since: number): string => `${((performance.now() - since) / 1000).toFixed(1)} s`

if (!process.env.DAYTONA_API_KEY) {
  console.error('DAYTONA_API_KEY is not set. Add it to .env.local (Daytona dashboard › API keys).')
  process.exit(1)
}

const daytona = new Daytona()
const snapshot = process.env.AEGIS_DAYTONA_SNAPSHOT || undefined
let sandbox: Sandbox | undefined

try {
  // Sandbox start: 20 s, then one retry (architectural.md §4.6).
  const params = {
    snapshot,
    networkBlockAll: true,
    ephemeral: true,
    autoStopInterval: 5,
    labels: { app: 'aegis', job: 'try-daytona' }
  }
  const t0 = performance.now()
  let attempts = 1
  try {
    sandbox = await daytona.create(params, { timeout: 20 })
  } catch {
    attempts = 2
    sandbox = await daytona.create(params, { timeout: 20 })
  }
  record(
    'create (network off)',
    sandbox.networkBlockAll === true,
    `${sandbox.id} from ${snapshot ?? 'the default snapshot'} in ${seconds(t0)} (${attempts} attempt${attempts > 1 ? 's' : ''}); networkBlockAll=${sandbox.networkBlockAll}`
  )

  const body = Buffer.from('Aegis try-daytona: harmless text, nothing to run.\n')
  const sha256 = createHash('sha256').update(body).digest('hex')
  const meta = { filename: 'note.txt', sha256, size: body.length, url: null, referrer: null }
  const t1 = performance.now()
  await sandbox.fs.createFolder('sample', '755')
  await sandbox.fs.uploadFile(body, 'sample/file')
  await sandbox.fs.uploadFile(Buffer.from(JSON.stringify(meta)), 'sample/meta.json')
  record('upload', true, `sample/file + sample/meta.json in ${seconds(t1)}`)

  const t2 = performance.now()
  const hashed = await sandbox.process.executeCommand(
    'sha256sum sample/file',
    undefined,
    undefined,
    30
  )
  const remote = hashed.result.trim().split(/\s+/)[0]
  record(
    'run a command',
    hashed.exitCode === 0 && remote === sha256,
    `sha256sum exit ${hashed.exitCode} in ${seconds(t2)}; ${remote === sha256 ? 'matches' : `got ${remote}`}`
  )

  // Any of curl, wget or python3 reaching a host means the network is not off. Two hosts: an
  // ordinary website, and a Daytona "essential service" (npm), which Tier 1/2 keep reachable
  // unless the network is blocked at creation; on Tier 3 both are open by default (docs:
  // network-limits › Tier-based network restrictions; PLAN.md decision 28).
  const probeHost = (url: string): string =>
    [
      `curl -sS -m 5 -o /dev/null ${url}`,
      `wget -q -T 5 -O /dev/null ${url}`,
      `python3 -c "import urllib.request; urllib.request.urlopen('${url}', timeout=5)"`
    ]
      .map((c) => `(${c}) 2>/dev/null`)
      .join(' || ')
  for (const [label, url] of [
    ['ordinary website', 'https://example.com'],
    ['essential service', 'https://registry.npmjs.org/']
  ]) {
    const t3 = performance.now()
    const net = await sandbox.process.executeCommand(
      `if ${probeHost(url)}; then echo REACHED; else echo BLOCKED; fi`,
      undefined,
      undefined,
      30
    )
    record(
      `network is off (${label}, ${url})`,
      net.result.trim() === 'BLOCKED',
      `${net.result.trim()} in ${seconds(t3)}`
    )
  }
} catch (err) {
  record('Daytona call', false, err instanceof Error ? err.message : String(err))
} finally {
  if (sandbox) {
    const t4 = performance.now()
    try {
      await sandbox.delete(60)
      record('delete', true, `at ${new Date().toISOString()} in ${seconds(t4)}`)
    } catch (err) {
      record('delete', false, `${sandbox.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
