// (1) Raw DNS (UDP/53) to public resolvers: a real answer, or an empty/refused reply from Daytona?
//     Compared across an allow-listed sandbox and a networkBlockAll one (what analysis uses).
// (2) In the allow-listed one: does droid exec work with api.factory.ai + prem.factory.ai only?
// No sample; keys scrubbed.  node --env-file=<main checkout>/.env logs/<this folder>/diagnose-dns.probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
const fk = process.env.FACTORY_API_KEY ?? ''
const dk = process.env.DAYTONA_API_KEY ?? ''
const scrub = (t) => String(t).split(fk).join('<FACTORY_API_KEY>').split(dk).join('<DAYTONA_API_KEY>')
const DNS = `
import socket, struct, sys
q = bytes.fromhex("abcd01000001000000000000076578616d706c6503636f6d0000010001")  # A example.com
for server in ["8.8.8.8", "1.1.1.1", "9.9.9.9"]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(4)
    try:
        s.sendto(q, (server, 53)); r, frm = s.recvfrom(512)
        flags, qd, an = struct.unpack(">HHH", r[2:8])
        ips = []
        if an: ips = [".".join(map(str, r[-4:]))]
        print(server, "reply from", frm[0], "rcode", flags & 15, "answers", an, ips)
    except Exception as e:
        print(server, "no reply:", type(e).__name__)
`
const daytona = new Daytona()
const out = { startedAt: new Date().toISOString(), trials: [] }
for (const [name, params, allow] of [
  ['allow-list api+prem', { domainAllowList: 'api.factory.ai,prem.factory.ai,registry.npmjs.org' }, 'api.factory.ai,prem.factory.ai'],
  ['networkBlockAll', { networkBlockAll: true }, null]
]) {
  const t = { name }
  let sb
  try {
    sb = await daytona.create({ ...params, ephemeral: true, autoStopInterval: 10, ttlMinutes: 30, labels: { app: 'aegis', job: 'droid-403-probe' } }, { timeout: 30 })
    const sh = (cmd, timeout, env) => sb.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
    if (allow) {
      t.installed = (await sh('npm install -g --no-audit --no-fund droid@0.238.0 >/dev/null 2>&1; droid --version', 300)).result.trim()
      await sb.updateNetworkSettings({ domainAllowList: allow })
    }
    await sb.fs.uploadFile(Buffer.from(DNS), '/tmp/dns.py')
    t.dns = (await sh('python3 /tmp/dns.py', 30)).result.trim().split('\n')
    if (allow) {
      const t0 = Date.now()
      const ran = await sh('cd /tmp && droid exec --output-format json "Reply with exactly one sentence saying this check worked. Do not use any tools."', 120, { FACTORY_API_KEY: fk })
      t.execMs = Date.now() - t0
      t.exitCode = ran.exitCode
      t.result = scrub(ran.result.trim()).slice(0, 300)
    }
  } catch (e) {
    t.error = scrub(e?.message ?? e)
  } finally {
    if (sb) { try { await sb.delete(60); t.deleted = true } catch (e) { t.deleted = `FAILED: ${scrub(e?.message ?? e)}` } }
  }
  out.trials.push(t)
}
await new Promise((r) => setTimeout(r, 3000))
const left = []
for await (const s of daytona.list()) if (s.state !== 'destroying' && s.state !== 'destroyed') left.push(`${s.id} (${s.state})`)
out.leftInOrg = left
out.finishedAt = new Date().toISOString()
console.log(JSON.stringify(out, null, 2))
