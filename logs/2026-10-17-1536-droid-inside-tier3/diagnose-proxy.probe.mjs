// (1) Which hosts does `droid exec` connect to? A logging proxy inside the sandbox sits in front of
//     Daytona's allow-list proxy and records each request's first line and the upstream's answer.
// (2) Is the allow-list only the proxy? Try reaching the web directly, ignoring the proxy env.
// Allow-list `factory.ai,*.factory.ai` (where droid exec worked). No sample; keys scrubbed.
//   node --env-file=<main checkout>/.env logs/<this folder>/diagnose-proxy.probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
const fk = process.env.FACTORY_API_KEY ?? ''
const dk = process.env.DAYTONA_API_KEY ?? ''
const scrub = (t) => String(t).split(fk).join('<FACTORY_API_KEY>').split(dk).join('<DAYTONA_API_KEY>')
const ALLOW = 'factory.ai,*.factory.ai'
const LOGGER = `
const net = require('net'), fs = require('fs')
const up = new URL(process.env.UPSTREAM)
net.createServer((c) => {
  c.once('data', (head) => {
    const line = head.toString('latin1').split('\\r\\n')[0]
    const u = net.connect(+up.port, up.hostname, () => { u.write(head); c.pipe(u); u.pipe(c) })
    u.once('data', (r) => fs.appendFileSync('/tmp/proxy.log', line + ' -> ' + r.toString('latin1').split('\\r\\n')[0] + '\\n'))
    u.on('error', (e) => { fs.appendFileSync('/tmp/proxy.log', line + ' -> ' + e.message + '\\n'); c.destroy() })
    c.on('error', () => u.destroy())
  })
}).listen(18081, '127.0.0.1')
`
const daytona = new Daytona()
const out = { startedAt: new Date().toISOString(), allow: ALLOW }
let sb
try {
  sb = await daytona.create({ domainAllowList: `${ALLOW},registry.npmjs.org`, ephemeral: true, autoStopInterval: 10, ttlMinutes: 30, labels: { app: 'aegis', job: 'droid-403-probe' } }, { timeout: 30 })
  const sh = (cmd, timeout, env) => sb.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
  out.installed = (await sh('npm install -g --no-audit --no-fund droid@0.238.0 >/dev/null 2>&1; droid --version', 300)).result.trim()
  await sb.updateNetworkSettings({ domainAllowList: ALLOW })
  // (2) Direct, ignoring the proxy env.
  out.direct = {}
  for (const [name, cmd] of Object.entries({
    'curl example.com via proxy': 'curl -sk -o /dev/null -m 8 -w "http=%{http_code} connect=%{http_connect}" https://example.com/',
    'curl example.com --noproxy': 'curl --noproxy "*" -sk -o /dev/null -m 8 -w "http=%{http_code}" https://example.com/',
    'curl 1.1.1.1 --noproxy': 'curl --noproxy "*" -sk -o /dev/null -m 8 -w "http=%{http_code}" https://1.1.1.1/',
    'curl http://example.com --noproxy': 'curl --noproxy "*" -s -o /dev/null -m 8 -w "http=%{http_code}" http://example.com/',
    'curl api.factory.ai --noproxy': 'curl --noproxy "*" -sk -o /dev/null -m 8 -w "http=%{http_code}" https://api.factory.ai/',
    'node fetch example.com (no proxy support)': 'node -e "fetch(\\"https://example.com\\").then(r=>console.log(\\"http=\\"+r.status),e=>console.log(\\"error: \\"+(e.cause?.code||e.message)))"',
    'DNS example.com': 'getent hosts example.com || echo no-dns',
    'DNS 8.8.8.8 udp/53 (python)': 'python3 -c "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(4);s.sendto(bytes.fromhex(\\"abcd01000001000000000000076578616d706c6503636f6d0000010001\\"),(\\"8.8.8.8\\",53));print(\\"answer\\",len(s.recv(512)),\\"bytes\\")" 2>&1 | tail -1'
  })) out.direct[name] = (await sh(`${cmd} || true`, 25)).result.trim()
  // (1) droid through the logging proxy.
  out.upstream = (await sh('echo $HTTPS_PROXY', 10)).result.trim()
  await sb.fs.uploadFile(Buffer.from(LOGGER), '/tmp/logproxy.cjs')
  await sh('UPSTREAM="$HTTPS_PROXY" nohup node /tmp/logproxy.cjs >/tmp/logproxy.out 2>&1 & sleep 1', 15)
  const P = 'http://127.0.0.1:18081'
  const ran = await sh('cd /tmp && droid exec --output-format json "Reply with exactly one sentence saying this check worked. Do not use any tools."', 120, { FACTORY_API_KEY: fk, HTTPS_PROXY: P, https_proxy: P, HTTP_PROXY: P, http_proxy: P })
  out.exitCode = ran.exitCode
  out.result = scrub(ran.result.trim()).slice(0, 300)
  await sh('sleep 2', 10)
  out.proxyLog = scrub((await sh('sort /tmp/proxy.log | uniq -c; cat /tmp/logproxy.out', 15)).result.trim()).split('\n')
} catch (e) {
  out.error = scrub(e?.message ?? e)
} finally {
  if (sb) { try { await sb.delete(60); out.deleted = true } catch (e) { out.deleted = `FAILED: ${scrub(e?.message ?? e)}` } }
}
await new Promise((r) => setTimeout(r, 3000))
const left = []
for await (const s of daytona.list()) if (s.state !== 'destroying' && s.state !== 'destroyed') left.push(`${s.id} (${s.state})`)
out.leftInOrg = left
out.finishedAt = new Date().toISOString()
console.log(JSON.stringify(out, null, 2))
