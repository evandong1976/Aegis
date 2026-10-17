// End-to-end: the built extension (pointed at a throwaway app on 47398) in headless Chrome clicks
// each download on the test site; the app scans them (real Daytona). Records every name that ever
// appears in the test downloads folder, the app's scan rows, what the site saw, and Chrome's
// download history.
// Usage: node e2e.mjs <ext-dir> <out-dir> <downloads-dir> <app-user-data> <site-port>
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [, , extDir, outDir, DL, appData, sitePort] = process.argv
const SITE = `http://127.0.0.1:${sitePort}/`
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
    '--window-size=1000,800',
    'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
)
const out = chrome.stdio[3]
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
    } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown') {
      const p = msg.params
      const text = p.args
        ? p.args.map((a) => a.value ?? a.description ?? '').join(' ')
        : JSON.stringify(p.exceptionDetails?.exception?.description ?? p.exceptionDetails)
      appendFileSync(join(outDir, 'sw-console.log'), `+${Date.now() - t0} ms  ${text}\n`)
    }
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const m = { id: ++id, method, params }
    if (sessionId) m.sessionId = sessionId
    pending.set(m.id, res)
    out.write(JSON.stringify(m) + '\0')
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const t0 = Date.now()
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// Every name that ever shows up in the downloads folder (two levels: .aegis-quarantine too).
const seen = new Map()
const watchDl = setInterval(() => {
  const walk = (dir, prefix) => {
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const n of names) {
      const rel = prefix + n
      if (!seen.has(rel)) {
        seen.set(rel, Date.now() - t0)
        appendFileSync(join(outDir, 'downloads-folder-timeline.txt'), `+${Date.now() - t0} ms  ${rel}\n`)
      }
      if (n === '.aegis-quarantine') walk(join(dir, n), rel + '/')
    }
  }
  walk(DL, '')
}, 15)

const db = () => new DatabaseSync(join(appData, 'aegis.db'), { readOnly: true })
const row = (filename) => {
  const d = db()
  try {
    return d.prepare('SELECT * FROM scans WHERE filename = ? ORDER BY created_at DESC LIMIT 1').get(filename)
  } finally {
    d.close()
  }
}
const waitDone = async (filename, ms = 60_000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const r = row(filename)
    if (r && (r.status === 'done' || r.status === 'failed')) return r
    await sleep(250)
  }
  return row(filename) ?? null
}

const loaded = await send('Extensions.loadUnpacked', { path: extDir })
check('extension loads', !!loaded.result?.id, loaded.result?.id ?? JSON.stringify(loaded.error))
await sleep(2500)

const { result: t } = await send('Target.createTarget', { url: 'about:blank' })
const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
const S = a.sessionId
await send('Page.enable', {}, S)
await send('Runtime.enable', {}, S)
const evaluate = async (expression, session = S) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session))
    .result?.result?.value
const click = async (sel) => {
  const [x, y] = await evaluate(
    `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + 10, r.y + r.height / 2] })()`
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, S)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, S)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, S)
}

await send('Page.navigate', { url: SITE }, S)
await sleep(1500)

// The service worker, to read Chrome's download history at the end.
const { result: targets } = await send('Target.getTargets')
const sw = targets.targetInfos.find((x) => x.type === 'service_worker' && x.url.endsWith('/background.js'))
const swSession = sw
  ? (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).result.sessionId
  : null
check('extension service worker running', !!swSession)
if (swSession) {
  // Evidence only: log Chrome's download events as the worker sees them.
  await send('Runtime.enable', {}, swSession)
  await evaluate(
    `chrome.downloads.onCreated.addListener((i) => console.log('onCreated', JSON.stringify({ id: i.id, url: i.url.slice(0, 60), finalUrl: i.finalUrl.slice(0, 60), filename: i.filename, mime: i.mime, state: i.state, byExtensionId: i.byExtensionId ?? null, totalBytes: i.totalBytes })));
     chrome.downloads.onChanged.addListener((d) => console.log('onChanged', JSON.stringify(d)));
     true`,
    swSession
  )
}

const cases = [
  { link: '#script', file: 'aegis-terminal-demo.command', expect: { verdict: 'unknown', action: 'held', cloud: true } },
  { link: '#pdf', file: 'statement.pdf', expect: { verdict: 'clean', action: 'delivered', cloud: false } },
  { link: '#fakejpg', file: 'photo.jpg', expect: { verdict: 'malicious', action: 'quarantined', cloud: true } },
  { link: '#cookie', file: 'report.sh', expect: { verdict: 'unknown', action: 'held', cloud: true } },
  { link: '#data', file: 'hello.sh', expect: { verdict: 'unknown', action: 'held', cloud: true } },
  { link: '#once', file: 'invoice.pdf', expect: { verdict: 'unknown', action: 'held', cloud: true } },
  { link: '#blob', file: 'notes.sh', expect: { verdict: 'unknown', action: 'held', cloud: true } }
]
const rows = {}
for (const c of cases) {
  const clicked = Date.now()
  await click(c.link)
  const r = await waitDone(c.file)
  rows[c.file] = r
  if (!r) {
    check(`${c.file}: scanned`, false, 'no scan row within 60 s')
    continue
  }
  const report = JSON.parse(r.report)
  const sandbox = report.sandbox ?? []
  const detail = `${r.verdict} / ${r.action} / ${r.source} / ${Date.now() - clicked} ms; checks: ${report.checks.map((x) => `${x.name}=${x.state}(${x.result})`).join(', ')}`
  check(
    `${c.file}: ${c.expect.verdict}, ${c.expect.action}`,
    r.verdict === c.expect.verdict && r.action === c.expect.action,
    detail
  )
  if (c.expect.cloud) {
    const ok = sandbox.length === 1 && sandbox[0].network === 'off' && !!sandbox[0].destroyedAt
    check(`${c.file}: went to a network-off Daytona sandbox, SHA-256 matched, sandbox deleted`,
      ok && report.checks.some((x) => x.name === 'Upload check (SHA-256)' && x.state === 'ok'),
      sandbox.map((s) => `${s.sandboxId} network=${s.network} destroyed=${s.destroyedAt}`).join('; '))
  } else {
    check(`${c.file}: never uploaded`, sandbox.length === 0)
  }
}

// In-memory path: these never appeared in the downloads folder under their own name.
for (const f of ['aegis-terminal-demo.command', 'photo.jpg', 'report.sh', 'hello.sh']) {
  check(`${f}: never written to the downloads folder`, !seen.has(f), seen.has(f) ? `seen at +${seen.get(f)} ms` : '')
}
check('statement.pdf: delivered into the downloads folder', readdirSync(DL).includes('statement.pdf'))

// The site saw the session cookie on the refetch: logged-in downloads work.
const siteLog = await (await fetch(`${SITE}requests`)).json()
writeFileSync(join(outDir, 'site-requests.json'), JSON.stringify(siteLog, null, 2))
const cookieHits = siteLog.filter((x) => x.path === '/private/report.sh')
check(
  'logged-in download: Chrome and the in-memory refetch both sent the cookie',
  cookieHits.length >= 2 && cookieHits.every((x) => /session=ok/.test(x.cookie ?? '')),
  `${cookieHits.length} requests: ${cookieHits.map((x) => x.cookie).join(' | ')}`
)
const onceHits = siteLog.filter((x) => x.path === '/once/invoice.pdf').length
check('one-time link: fetched again for the fallback (3 requests)', onceHits === 3, `${onceHits} requests`)

// ~/Downloads watcher: a file another app drops in.
writeFileSync(join(DL, 'airdrop-tool.command'), '#!/bin/sh\necho from another app\n', { mode: 0o755 })
const dropped = Date.now()
const w = await waitDone('airdrop-tool.command', 30_000)
rows['airdrop-tool.command'] = w
check(
  'watcher: a file dropped into the folder is quarantined and scanned',
  w?.source === 'watcher' && w?.action === 'held' && !readdirSync(DL).includes('airdrop-tool.command'),
  w ? `${w.verdict} / ${w.action} after ${Date.now() - dropped} ms; left the folder at +${seen.get('airdrop-tool.command')} ms` : 'no row'
)
check('watcher: an old file that changes is left alone', readdirSync(DL).includes('old-notes.txt'))

// Held files: in the app's quarantine, not executable.
const qdir = join(appData, 'quarantine')
const held = []
for (const d of readdirSync(qdir)) {
  for (const f of readdirSync(join(qdir, d))) {
    if (f === 'entry.json') continue
    held.push(`${(statSync(join(qdir, d, f)).mode & 0o777).toString(8)}  ${d}/${f}`)
  }
}
writeFileSync(join(outDir, 'quarantine-listing.txt'), held.join('\n') + '\n')
check('held files are .aegis with mode 600', held.length >= 6 && held.every((l) => l.startsWith('600') && l.endsWith('.aegis')), `${held.length} files`)

const history = swSession ? await evaluate('chrome.downloads.search({}).then(items => items.map(i => ({ id: i.id, url: i.url.slice(0, 80), filename: i.filename, state: i.state, byExtensionId: i.byExtensionId ?? null })))', swSession) : null
writeFileSync(join(outDir, 'chrome-download-history.json'), JSON.stringify(history, null, 2))
writeFileSync(join(outDir, 'downloads-folder-final.txt'), readdirSync(DL).join('\n') + '\n')
writeFileSync(join(outDir, 'scan-rows.json'), JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r && { ...r, report: JSON.parse(r.report), reasons: JSON.parse(r.reasons) }])), null, 2))
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
clearInterval(watchDl)
chrome.kill()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed} / ${results.length} passed`)
process.exit(failed ? 1 : 0)
