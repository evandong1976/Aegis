// Which Factory subdomains does `droid exec` need beyond app/api, and how does Daytona enforce the
// allow-list (proxy env vars? 403 on CONNECT?). Allow-list only, no sample, keys scrubbed.
//   node --env-file=<main checkout>/.env logs/<this folder>/diagnose-hosts.probe.mjs 'list1' 'list2' ...
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
const fk = process.env.FACTORY_API_KEY ?? ''
const dk = process.env.DAYTONA_API_KEY ?? ''
const scrub = (t) => String(t).split(fk).join('<FACTORY_API_KEY>').split(dk).join('<DAYTONA_API_KEY>')
const daytona = new Daytona()
const out = { startedAt: new Date().toISOString(), trials: [] }
for (const allow of process.argv.slice(2)) {
  const t = { allow }
  let sb
  try {
    sb = await daytona.create({ domainAllowList: `${allow},registry.npmjs.org`, ephemeral: true, autoStopInterval: 10, ttlMinutes: 30, labels: { app: 'aegis', job: 'droid-403-probe' } }, { timeout: 30 })
    const sh = (cmd, timeout, env) => sb.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
    t.installed = (await sh('npm install -g --no-audit --no-fund droid@0.238.0 >/dev/null 2>&1; droid --version', 300)).result.trim()
    await sb.updateNetworkSettings({ domainAllowList: allow })
    t.proxyEnv = (await sh('env | grep -i -E "^(https?|no|all)_proxy=" | sed -E "s#//[^@/]*@#//<cred>@#" || true', 15)).result.trim() || 'none'
    t.reach = {}
    for (const h of ['api.factory.ai', 'relay.factory.ai', 'telemetry.factory.ai', 'example.com']) {
      const r = await sh(`curl -sk -o /dev/null -m 8 -w "http=%{http_code} connect=%{http_connect}" https://${h}/ || true`, 20)
      t.reach[h] = r.result.trim()
    }
    const ran = await sh('cd /tmp && droid exec --output-format json "Reply with exactly one sentence saying this check worked. Do not use any tools."', 120, { FACTORY_API_KEY: fk })
    t.exitCode = ran.exitCode
    t.result = scrub(ran.result.trim()).slice(0, 300)
    const logs = scrub((await sh('cat ~/.factory/logs/* 2>/dev/null', 30)).result)
    t.requestUrls = [...new Set(logs.match(/requestUrl: '[^']+'/g) ?? [])]
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
