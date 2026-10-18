// One real download through the built extension in headless Chrome: opens the file's URL on the
// local demo server, then waits for the app (real Daytona + Droid) to finish scanning it. The
// app's own capture (AEGIS_CAPTURE_LIVE=download) screenshots the live view meanwhile.
// Usage: node e2e.mjs <ext-dir> <out-dir> <downloads-dir> <app-user-data> <file-url>
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [, , extDir, outDir, DL, appData, fileUrl] = process.argv
const file = basename(new URL(fileUrl).pathname)
const profile = join(DL, '..', 'chrome-profile') // under the run folder, fresh each run
mkdirSync(join(profile, 'Default'), { recursive: true })
writeFileSync(
  join(profile, 'Default', 'Preferences'),
  JSON.stringify({
    download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true },
    profile: { default_content_setting_values: { automatic_downloads: 1 } }
  })
)
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
)
let id = 0
const pending = new Map()
let buf = ''
chrome.stdio[4].on('data', (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i))
    buf = buf.slice(i + 1)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const m = { id: ++id, method, params }
    if (sessionId) m.sessionId = sessionId
    pending.set(m.id, res)
    chrome.stdio[3].write(JSON.stringify(m) + '\0')
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const seen = new Map()
const watchDl = setInterval(() => {
  for (const n of readdirSync(DL)) {
    if (seen.has(n)) continue
    seen.set(n, Date.now() - t0)
    appendFileSync(join(outDir, 'downloads-folder-timeline.txt'), `+${Date.now() - t0} ms  ${n}\n`)
  }
}, 15)

const row = () => {
  const d = new DatabaseSync(join(appData, 'aegis.db'), { readOnly: true })
  try {
    return d
      .prepare('SELECT * FROM scans WHERE filename = ? ORDER BY created_at DESC LIMIT 1')
      .get(file)
  } finally {
    d.close()
  }
}

const loaded = await send('Extensions.loadUnpacked', { path: extDir })
check('extension loads', !!loaded.result?.id, loaded.result?.id ?? JSON.stringify(loaded.error))
await sleep(2500)

const { result: t } = await send('Target.createTarget', { url: 'about:blank' })
const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
await send('Page.enable', {}, a.sessionId)
await send('Page.navigate', { url: fileUrl }, a.sessionId)
console.log(`+${Date.now() - t0} ms  opened ${fileUrl}`)

let r = null
const until = Date.now() + 360_000
while (Date.now() < until) {
  r = row()
  if (r && (r.status === 'done' || r.status === 'failed')) break
  await sleep(500)
}
if (!r) {
  check(`${file}: scanned`, false, 'no scan row within 360 s')
} else {
  const report = JSON.parse(r.report)
  const sandbox = report.sandbox ?? []
  check(
    `${file}: scanned`,
    r.status === 'done',
    `${r.verdict} / ${r.action} / ${Math.round((Date.now() - t0) / 1000)} s; checks: ${report.checks.map((x) => `${x.name}=${x.state}(${x.result})`).join(', ')}`
  )
  check(
    `${file}: went to a network-off Daytona sandbox that was deleted`,
    sandbox.length === 1 && sandbox[0].network === 'off' && !!sandbox[0].destroyedAt,
    sandbox.map((s) => `${s.sandboxId} network=${s.network} destroyed=${s.destroyedAt}`).join('; ')
  )
  check(
    `${file}: never in the downloads folder before its verdict`,
    !seen.has(file) || r.action === 'delivered',
    seen.has(file) ? `appeared at +${seen.get(file)} ms (action ${r.action})` : 'not in the folder'
  )
  writeFileSync(
    join(outDir, 'scan-row.json'),
    JSON.stringify({ ...r, report, reasons: JSON.parse(r.reasons) }, null, 2)
  )
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
clearInterval(watchDl)
chrome.kill()
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed} / ${results.length} passed`)
process.exit(failed ? 1 : 0)
