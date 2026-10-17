// Why does `droid exec` inside an allow-listed sandbox get 403 when the same key works on the Mac?
// One trial per droid version: sandbox with domainAllowList (Factory + npm), install, narrow to
// Factory, run droid exec, then read droid's own logs for the failing request. No sample anywhere.
// Keys are scrubbed from all output. Run from the repo root with the env file:
//   node --env-file=<main checkout>/.env logs/<this folder>/diagnose-403.probe.mjs
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
const fk = process.env.FACTORY_API_KEY ?? ''
const dk = process.env.DAYTONA_API_KEY ?? ''
const scrub = (t) => String(t).split(fk).join('<FACTORY_API_KEY>').split(dk).join('<DAYTONA_API_KEY>')
const FACTORY = 'app.factory.ai,api.factory.ai'
const versions = (process.argv[2] ?? '0.232.0,0.238.0').split(',')
const daytona = new Daytona()
const out = { startedAt: new Date().toISOString(), trials: [] }

for (const version of versions) {
  const t = { version }
  let sb
  try {
    sb = await daytona.create(
      { domainAllowList: `${FACTORY},registry.npmjs.org`, ephemeral: true, autoStopInterval: 10, ttlMinutes: 30, labels: { app: 'aegis', job: 'droid-403-probe' } },
      { timeout: 30 }
    )
    const sh = (cmd, timeout, env) => sb.process.executeCommand(`sh -c '${cmd.replace(/'/g, `'"'"'`)}'`, undefined, env, timeout)
    const inst = await sh(`npm install -g --no-audit --no-fund droid@${version} >/dev/null 2>&1; droid --version`, 300)
    t.installed = inst.result.trim()
    await sb.updateNetworkSettings({ domainAllowList: FACTORY })
    const t0 = Date.now()
    const ran = await sh('cd /tmp && droid exec --output-format json "Reply with exactly one sentence saying this check worked. Do not use any tools."', 120, { FACTORY_API_KEY: fk })
    t.execMs = Date.now() - t0
    t.exitCode = ran.exitCode
    t.result = scrub(ran.result.trim()).slice(0, 600)
    // droid's own logs: which request failed, and with what.
    const logs = await sh('ls -la ~/.factory ~/.factory/logs 2>/dev/null | head -30; for f in $(ls -t ~/.factory/logs/* 2>/dev/null | head -3); do echo "== $f"; grep -iE "40[13]|forbidden|https?://|error|model" "$f" | tail -40; done', 30)
    t.logs = scrub(logs.result).slice(-6000)
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
