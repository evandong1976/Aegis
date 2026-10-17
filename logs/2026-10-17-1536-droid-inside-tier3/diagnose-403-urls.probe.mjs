// Follow-up to diagnose-403: which URLs does droid call, and does a wider Factory allow-list
// (*.factory.ai) change the 403? Same rules: allow-list only, no sample, keys scrubbed.
//   node --env-file=<main checkout>/.env logs/<this folder>/diagnose-403-urls.probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
const fk = process.env.FACTORY_API_KEY ?? ''
const dk = process.env.DAYTONA_API_KEY ?? ''
const scrub = (t) => String(t).split(fk).join('<FACTORY_API_KEY>').split(dk).join('<DAYTONA_API_KEY>')
const daytona = new Daytona()
const out = { startedAt: new Date().toISOString(), trials: [] }
for (const allow of ['app.factory.ai,api.factory.ai', 'factory.ai,*.factory.ai']) {
  const t = { allow }
  let sb
  try {
    sb = await daytona.create({ domainAllowList: `${allow},registry.npmjs.org`, ephemeral: true, autoStopInterval: 10, ttlMinutes: 30, labels: { app: 'aegis', job: 'droid-403-probe' } }, { timeout: 30 })
    const sh = (cmd, timeout, env) => sb.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
    t.installed = (await sh('npm install -g --no-audit --no-fund droid@0.238.0 >/dev/null 2>&1; droid --version', 300)).result.trim()
    await sb.updateNetworkSettings({ domainAllowList: allow })
    t.reach = {}
    for (const h of ['api.factory.ai', 'app.factory.ai', 'telemetry.factory.ai', 'relay.factory.ai', 'example.com']) {
      const r = await sh(`curl -sk -o /dev/null -m 8 -w "%{http_code}" https://${h}/ || true`, 20)
      t.reach[h] = r.result.trim() === '000' ? 'unreachable' : `HTTP ${r.result.trim()}`
    }
    const ran = await sh('cd /tmp && droid exec --output-format json "Reply with exactly one sentence saying this check worked. Do not use any tools."', 120, { FACTORY_API_KEY: fk })
    t.exitCode = ran.exitCode
    t.result = scrub(ran.result.trim()).slice(0, 400)
    const logs = await sh('cat ~/.factory/logs/* 2>/dev/null', 30)
    const text = scrub(logs.result)
    t.urls = [...new Set(text.match(/https?:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9_/.-]*)?/g) ?? [])].slice(0, 60)
    t.lines403 = [...new Set(text.split('\n').filter((l) => /403|forbidden/i.test(l)).map((l) => l.replace(/"tags":\{[^}]*\}/g, '"tags":{…}').slice(0, 700)))].slice(0, 6)
    t.firstLines = text.split('\n').filter((l) => /(request|fetch|url|endpoint|path)/i.test(l)).map((l) => l.replace(/"tags":\{[^}]*\}/g, '"tags":{…}').slice(0, 400)).slice(0, 15)
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
