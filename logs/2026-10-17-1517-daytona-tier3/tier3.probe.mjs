// Tier 3 check (2026-10-17): what network settings does this Daytona org accept now?
// Harmless curl only. Three ephemeral sandboxes, one at a time, each deleted in a finally.
// Run from the repo root: node logs/<this folder>/tier3.probe.mjs
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
const require = createRequire(process.cwd() + '/package.json')
const { Daytona } = require('@daytona/sdk')
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f)
const key = process.env.DAYTONA_API_KEY
const scrub = (v) => String(v).split(key).join('<KEY>')
const daytona = new Daytona({ apiKey: key })
const HOSTS = ['example.com', 'registry.npmjs.org', 'app.factory.ai', 'api.factory.ai']
const out = { startedAt: new Date().toISOString(), sdk: '@daytona/sdk 0.220.0' }

async function reach(sb) {
  const res = {}
  await Promise.all(HOSTS.map(async (host) => {
    const r = await sb.process.executeCommand(`curl -s -o /dev/null -m 8 -w '%{http_code}' https://${host}/ || true`, undefined, undefined, 20)
    const code = r.result.trim()
    res[host] = code === '000' || code === '' ? 'unreachable' : `HTTP ${code}`
  }))
  return Object.fromEntries(HOSTS.map((h) => [h, res[h]]))
}

async function trial(name, params, body) {
  const t = { params }
  let sb
  try {
    const t0 = Date.now()
    sb = await daytona.create({ ...params, ephemeral: true, autoStopInterval: 5, labels: { app: 'aegis', purpose: 'tier3-probe' } }, { timeout: 30 })
    t.createMs = Date.now() - t0
    t.sandboxNetworkBlockAll = sb.networkBlockAll
    t.reach = await reach(sb)
    if (body) await body(sb, t)
  } catch (e) {
    t.error = scrub(e?.message ?? e)
  } finally {
    if (sb) { try { await daytona.delete(sb); t.deleted = true } catch (e) { t.deleted = `FAILED: ${scrub(e?.message ?? e)}` } }
  }
  out[name] = t
}

// 1. Default settings, then turn the network off after creation, then back on.
await trial('1-default-then-update', {}, async (sb, t) => {
  try { await sb.updateNetworkSettings({ networkBlockAll: true }); t.updateBlockAll = 'accepted'; t.reachAfterBlockAll = await reach(sb) }
  catch (e) { t.updateBlockAll = `refused: ${scrub(e?.message ?? e)}` }
})
// 2. Allow-list for Factory only, at creation (what option A would need).
await trial('2-factory-allowlist-at-create', { domainAllowList: 'app.factory.ai,api.factory.ai' })
// 3. networkBlockAll at creation, as Aegis's analysis sandboxes use.
await trial('3-block-all-at-create', { networkBlockAll: true })

try { const r = await daytona.list(); out.leftInOrg = (Array.isArray(r) ? r : r.items ?? []).length } catch (e) { out.leftInOrg = `list failed: ${scrub(e?.message ?? e)}` }
out.finishedAt = new Date().toISOString()
console.log(JSON.stringify(out, null, 2))
