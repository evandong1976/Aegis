// End-to-end: the built extension (pointed at a throwaway app on 47397) in headless Chrome,
// against a local test page. Never clicks the feed-listed link, and every malicious click is
// answered with Back to safety.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , extDir, outDir] = process.argv
const PAGE = 'http://127.0.0.1:8765/test.html'
const profile = mkdtempSync(join(outDir, 'chrome-'))
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1100,900',
    'about:blank'
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
)
const out = chrome.stdio[3]
let id = 0
const pending = new Map()
const listeners = []
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
    } else listeners.forEach((l) => l(msg))
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
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const loaded = await send('Extensions.loadUnpacked', { path: extDir })
check('extension loads', !!loaded.result?.id, loaded.result?.id ?? JSON.stringify(loaded.error))
await sleep(1500)

const { result: t } = await send('Target.createTarget', { url: 'about:blank' })
const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
const S = a.sessionId
await send('Page.enable', {}, S)
await send('Runtime.enable', {}, S)
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, S)
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, S)).result?.result?.value
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' }, S)
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
const goto = async (url) => {
  await send('Page.navigate', { url }, S)
  await sleep(1500)
}
const center = (sel) =>
  evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + Math.min(20, r.width / 2), r.y + r.height / 2] })()`)
const click = async (sel, opts = {}) => {
  const [x, y] = await center(sel)
  const button = opts.button ?? 'left'
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, S)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, modifiers: opts.modifiers ?? 0 }, S)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, modifiers: opts.modifiers ?? 0 }, S)
}
const key = async (k, code = k, keyCode) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode }, S)
  if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r' }, S)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode }, S)
}
const guardOpen = () => evaluate(`!!document.getElementById('aegis-click-guard')`)
const marks = () =>
  evaluate(`Object.fromEntries([...document.querySelectorAll('a[id]')].map(a => [a.id, a.getAttribute('data-aegis-verdict')]))`)
/** Text inside the guard's closed shadow root, read through DevTools (pierces closed roots). */
const guardText = async () => {
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true }, S)
  const texts = []
  const walk = (n, inGuard) => {
    const here = inGuard || n.attributes?.includes?.('aegis-click-guard')
    if (here && n.nodeType === 3 && n.nodeValue.trim()) texts.push(n.nodeValue.trim())
    for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c, here)
  }
  walk(doc.result.root, false)
  return texts
}

// 1. Outlines after the first scan, then the link added 2.5 s later
await goto(PAGE)
await sleep(4500)
let m = await marks()
console.log('marks:', JSON.stringify(m))
check('phishing link outlined malicious', m.phish === 'malicious')
check('Safe Browsing test URL outlined malicious', m.sbtest === 'malicious')
check('URLhaus-listed link outlined malicious', m.feed === 'malicious')
check('mismatch link outlined suspicious', m.mismatch === 'suspicious')
check('short link marked unknown (no outline, held at the click)', m.short === 'unknown')
check('redirect wrapper judged by its destination', m.wrapped === 'suspicious')
check('clean link not marked', m.clean === null)
check('javascript:void(0) not marked', m.void === null)
check('link added later (MutationObserver) gets a verdict', m.late === 'malicious' || m.late === 'suspicious', String(m.late))
const style = await evaluate(`getComputedStyle(document.getElementById('phish')).outlineStyle + ' / ' + getComputedStyle(document.getElementById('mismatch')).outlineStyle`)
check('outline styles: malicious dashed, suspicious dotted', style === 'dashed / dotted', style)
await shot('1-outlines')

// 2. Hover note
const [hx, hy] = await center('#phish')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hx, y: hy }, S)
await sleep(400)
check('hover note appears on an outlined link', await evaluate(`!!document.getElementById('aegis-link-note')`))
await shot('2-hover-note')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 850 }, S)

// 3. Malicious click → guard → Back to safety (Escape)
await click('#phish')
await sleep(600)
check('malicious click opens the guard', await guardOpen())
const text = await guardText()
check('guard shows link text vs destination', text.includes('accounts.google.com') && text.some((s) => s.startsWith('login-northwlnd-io.sbs/sso')), text.slice(0, 6).join(' | '))
check('guard has no Inspect in sandbox', !text.includes('Inspect in sandbox'))
check('guard offers Trust this site for a normal domain', text.includes('Trust this site'))
check('guard URL has the session token stripped', !text.some((s) => s.includes('8f2c1a9e77aa')))
await shot('3-guard-malicious')
await key('Escape', 'Escape', 27)
await sleep(400)
check('Back to safety closes the guard and stays on the page', !(await guardOpen()) && (await evaluate('location.href')) === PAGE)

// 4. Short link → guard without Trust
await click('#short')
await sleep(600)
const st = await guardText()
check('short link click opens the guard', await guardOpen())
check('short link guard has no Trust this site', !st.includes('Trust this site'), st.filter((s) => /Trust|Continue|Back/.test(s)).join(', '))
check('short link guard explains it can’t see the destination', st.some((s) => s.includes('can’t see')))
await shot('4-guard-shortlink')
await key('Escape', 'Escape', 27)
await sleep(300)

// 5. Plain clean click navigates
await click('#clean')
await sleep(2500)
const after = await evaluate('location.href')
check('clean link opens normally', after.startsWith('https://github.com/chalk-ai/examples'), after)
await goto(PAGE)
await sleep(3500)

// 6. Suspicious (harmless target) → Continue anyway navigates
await click('#mismatch')
await sleep(600)
check('suspicious click opens the guard', await guardOpen())
await key('Tab', 'Tab', 9)
await key('Enter', 'Enter', 13)
await sleep(2500)
const after2 = await evaluate('location.href')
check('Continue anyway opens the link', after2 === 'https://example.com/', after2)
await goto(PAGE)
await sleep(3500)

// 7. Trust this site on the mismatch link (example.com), then it's no longer guarded
await click('#mismatch')
await sleep(600)
await key('Tab', 'Tab', 9)
await key('Tab', 'Tab', 9)
await key('Enter', 'Enter', 13)
await sleep(2500)
const after3 = await evaluate('location.href')
check('Trust this site opens the link', after3 === 'https://example.com/', after3)
await goto(PAGE)
await sleep(4000)
m = await marks()
check('trusted site no longer outlined after reload', m.mismatch === null, String(m.mismatch))

// 8. Popup page counts for the test tab
await send('Target.activateTarget', { targetId: t.targetId })
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed} pass, ${failed} fail`)
chrome.kill()
process.exit(failed ? 1 : 0)
