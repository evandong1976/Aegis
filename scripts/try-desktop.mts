// Can a network-off Daytona sandbox show its desktop (feature/visualization)? The live view's
// Desktop tab draws pictures of the sandbox's Linux desktop while the file is opened there. This
// checks, live, that Daytona's Computer Use (Xvfb + xfce4 + VNC) starts in a sandbox created with
// `networkBlockAll`, that a terminal window can open the sample on that desktop, that screenshots
// come back, and that the network is still off afterwards.
//
// The sample is demo/aegis-terminal-demo.command (harmless: it prints a labelled message). It runs
// only inside the sandbox, never on this Mac.
//
//   pnpm try:desktop
//
// Needs DAYTONA_API_KEY. Writes logs/<date-time>-desktop-probe/ (run.json and the screenshots) and
// exits 1 if any check fails.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Daytona, type Sandbox } from '@daytona/sdk'
import { withSandbox, type SandboxClient } from '../src/main/daytona.ts'

const SAMPLE = 'demo/aegis-terminal-demo.command'

const stamp = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

if (!process.env.DAYTONA_API_KEY) {
  console.error('DAYTONA_API_KEY is not set. Add it to .env.local (Daytona dashboard › API keys).')
  process.exit(1)
}

const outDir = join('logs', `${stamp()}-desktop-probe`)
await mkdir(outDir, { recursive: true })
const failures: string[] = []
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const bytes = await readFile(SAMPLE)
const steps: Array<{ step: string; ms: number; detail: string }> = []
const timed = async <T,>(
  step: string,
  fn: () => Promise<T>,
  detail: (v: T) => string
): Promise<T> => {
  const t0 = performance.now()
  try {
    const v = await fn()
    steps.push({ step, ms: Math.round(performance.now() - t0), detail: detail(v) })
    console.log(`  ${step}: ${steps[steps.length - 1].detail} (${steps[steps.length - 1].ms} ms)`)
    return v
  } catch (err) {
    steps.push({ step, ms: Math.round(performance.now() - t0), detail: `failed: ${message(err)}` })
    console.log(`  ${step}: failed: ${message(err)}`)
    throw err
  }
}

const outcome = await withSandbox(
  new Daytona() as unknown as SandboxClient,
  { labels: { job: 'try-desktop' }, snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || undefined },
  async (session) => {
    const box = session.sandbox as unknown as Sandbox
    console.log(`  created ${session.id} with the network off`)
    const meta = await session.upload(bytes, {
      filename: 'aegis-terminal-demo.command',
      url: null,
      referrer: null,
      contentType: 'text/x-shellscript'
    })
    const offBefore = await session.networkIsOff()
    if (!offBefore) throw new Error('the sandbox can reach the network; stopping')

    await timed(
      'computerUse.start',
      () => box.computerUse.start(),
      (r) => JSON.stringify(r)
    )
    await sleep(2000)
    const status = await timed(
      'computerUse.getStatus',
      () => box.computerUse.getStatus(),
      (r) => JSON.stringify(r)
    )
    const display = await timed(
      'display.getInfo',
      () => box.computerUse.display.getInfo(),
      (r) => JSON.stringify(r)
    )
    const env = await session.exec(
      'desktop environment',
      'command -v xfce4-terminal xterm x-terminal-emulator; ps -eo args | grep -E "^(/usr/bin/)?Xvfb" | head -2'
    )
    console.log(env.result.replace(/^/gm, '    | '))

    // Open the sample the way Finder opens a .command file: in a terminal window, on the desktop.
    const open = await session.exec(
      'open sample in a desktop terminal',
      [
        'cp sample/file /tmp/aegis-terminal-demo.command && chmod 500 /tmp/aegis-terminal-demo.command',
        // Arguments spelled out: the sandbox's shell doesn't word-split "$A" (2026-10-17-1818 run).
        // --disable-server: no D-Bus session here. setsid: outlive this command's process group.
        'DISPLAY=:0 setsid -f xfce4-terminal --disable-server --hold --title=aegis-terminal-demo.command ' +
          '-x sh -x /tmp/aegis-terminal-demo.command >/tmp/aegis-term.log 2>&1 </dev/null',
        'sleep 1.5; echo launched; ps -eo pid,args | grep -E "xfce4-terminal|xterm" | grep -v grep; cat /tmp/aegis-term.log'
      ].join('; ')
    )
    console.log(open.result.replace(/^/gm, '    | '))
    await sleep(2500)

    const frames: Array<{ file: string; bytes: number; ms: number }> = []
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now()
      const shot = await box.computerUse.screenshot.takeCompressed({
        format: 'jpeg',
        quality: 70,
        scale: 0.5
      })
      const ms = Math.round(performance.now() - t0)
      const data = Buffer.from(shot.screenshot ?? '', 'base64')
      const file = join(outDir, `frame-${i}.jpg`)
      await writeFile(file, data)
      frames.push({ file, bytes: data.length, ms })
      console.log(`  screenshot ${i}: ${data.length} bytes in ${ms} ms → ${file}`)
      await sleep(800)
    }
    const windows = await timed(
      'display.getWindows',
      () => box.computerUse.display.getWindows(),
      (r) => JSON.stringify(r).slice(0, 400)
    )
    const offAfter = await session.networkIsOff()
    return { meta, offBefore, offAfter, status, display, windows, frames, open: open.result }
  }
)

for (const e of outcome.log) {
  console.log(
    `  ${e.at}  ${e.ok ? 'ok  ' : 'FAIL'} ${e.step.padEnd(36)} ${String(e.ms).padStart(6)} ms  ${e.detail}`
  )
}

const r = outcome.result
console.log('\nChecks:')
check(!outcome.error, outcome.error ? `sandbox job: ${outcome.error}` : 'sandbox job finished')
check(r?.offBefore === true, 'network off before the desktop started')
check(
  steps.some((s) => s.step === 'computerUse.start' && !s.detail.startsWith('failed')),
  'desktop started'
)
check(
  !!r && r.frames.length === 3 && r.frames.every((f) => f.bytes > 1000),
  'three screenshots came back'
)
check(
  !!r && JSON.stringify(r.windows).includes('aegis-terminal-demo'),
  'a terminal window with the sample is open on the desktop'
)
check(r?.offAfter === true, 'network still off after the desktop started')
check(outcome.deleted, 'sandbox deleted')

await writeFile(
  join(outDir, 'run.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      sample: SAMPLE,
      snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || 'default',
      error: outcome.error ?? null,
      deleted: outcome.deleted,
      steps,
      sandboxLog: outcome.log,
      result: r ?? null,
      failures
    },
    null,
    2
  ) + '\n'
)
console.log(`\nEvidence: ${outDir}/`)
process.exit(failures.length ? 1 : 0)
