// Scratch probe: does a create-time domainAllowList open Factory's hosts on this tier?
// Harmless curl only; ephemeral sandbox deleted in finally. Run from the repo root.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
const key = process.env.DAYTONA_API_KEY
const scrub = (v) => String(v).split(key).join('<KEY>')
const daytona = new Daytona({ apiKey: key })
const out = { at: new Date().toISOString(), domainAllowList: 'app.factory.ai,api.factory.ai' }
let sb
try {
  const t0 = Date.now()
  sb = await daytona.create({ domainAllowList: out.domainAllowList, ephemeral: true, autoStopInterval: 5, labels: { app: 'aegis', purpose: 'allowlist-probe' } })
  out.createMs = Date.now() - t0
  out.reach = {}
  for (const host of ['app.factory.ai', 'api.factory.ai', 'registry.npmjs.org', 'example.com']) {
    const r = await sb.process.executeCommand(`curl -s -o /dev/null -m 8 -w '%{http_code}' https://${host}/ || true`, undefined, undefined, 15)
    const code = r.result.trim()
    out.reach[host] = code === '000' || code === '' ? 'unreachable' : `HTTP ${code}`
  }
} catch (e) {
  out.error = scrub(e?.message ?? e)
} finally {
  if (sb) { await daytona.delete(sb); out.deleted = true }
  console.log(JSON.stringify(out, null, 2))
}
