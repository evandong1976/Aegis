// Checks every connection at startup, every 60 s and on demand (BUILD_PROMPT §4.1).
// Checks that need a sponsor SDK report `unconfigured` (no key) or `pending` (key set, live check
// not built yet) until their milestone lands. Never report `ok` for something that wasn't checked.

import { execFile } from 'child_process'
import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { EXTENSION_PING_TTL_MS, SERVICE_NAMES } from '@shared/constants'
import type { ServiceHealth, ServiceKey, ServiceState } from '@shared/types'
import { config } from './config'
import { fnKeyStatus } from './fnkey'

const REQUIRED: ServiceKey[] = ['bridge', 'sqlite', 'daytona', 'droid', 'chalk', 'safeBrowsing']

// Google's documented test URL; a working key returns a MALWARE match for it.
const SAFE_BROWSING_TEST_URL = 'http://malware.testing.google.test/testing/malware/'

export interface HealthContext {
  bridgeListening: boolean
  extensionLastSeen: number | null
  storeOpen: boolean
}

type Check = Omit<ServiceHealth, 'key' | 'name' | 'required' | 'checkedAt'>

function result(state: ServiceState, detail: string, latencyMs?: number): Check {
  return latencyMs === undefined ? { state, detail } : { state, detail, latencyMs }
}

function keyed(envNames: string[] | string, milestone: number, what: string): Check {
  const has = typeof envNames === 'string' ? config.hasPrefix(envNames) : config.has(...envNames)
  const label = typeof envNames === 'string' ? `${envNames}*` : envNames.join(', ')
  if (!has)
    return result('unconfigured', `${label} not set. Add it to .env.local, then restart Aegis.`)
  return result('pending', `Key set. The live ${what} check arrives with milestone ${milestone}.`)
}

function checkBridge(ctx: HealthContext): Check {
  if (!ctx.bridgeListening)
    return result('down', `Not listening on 127.0.0.1:${config.bridgePort}.`)
  const seen = ctx.extensionLastSeen
  if (!seen || Date.now() - seen > EXTENSION_PING_TTL_MS) {
    return result(
      'degraded',
      'Extension not connected. Run pnpm build:extension and load extension/dist in chrome://extensions.'
    )
  }
  return result(
    'ok',
    `Listening on 127.0.0.1:${config.bridgePort}; extension seen ${Math.round((Date.now() - seen) / 1000)} s ago.`
  )
}

async function checkSafeBrowsing(): Promise<Check> {
  const key = process.env.SAFE_BROWSING_KEY
  if (!key)
    return result(
      'unconfigured',
      'SAFE_BROWSING_KEY not set. Add it to .env.local, then restart Aegis.'
    )
  const started = Date.now()
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          client: { clientId: 'aegis', clientVersion: '0.1.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: SAFE_BROWSING_TEST_URL }]
          }
        })
      }
    )
    const ms = Date.now() - started
    if (!res.ok) return result('down', `Lookup failed with HTTP ${res.status}. Check the key.`, ms)
    const body = (await res.json()) as { matches?: unknown[] }
    return body.matches?.length
      ? result('ok', 'Test URL matched as expected.', ms)
      : result('degraded', 'Lookup worked but the test URL did not match.', ms)
  } catch (err) {
    return result('down', `Lookup failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function checkDocker(): Promise<Check> {
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['info', '--format', '{{.ServerVersion}}'],
      { timeout: 4000 },
      (err, stdout) => {
        if (err)
          resolve(
            result('down', 'Docker is not running. It is only the fallback when Daytona is down.')
          )
        else resolve(result('ok', `Docker ${stdout.trim()} is running.`, Date.now() - started))
      }
    )
  })
}

async function checkDownloads(): Promise<Check> {
  try {
    await readdir(join(homedir(), 'Downloads'))
    return result('ok', 'Aegis can read ~/Downloads.')
  } catch {
    return result(
      'down',
      'No access to ~/Downloads. Allow it in System Settings › Privacy & Security › Files and Folders.'
    )
  }
}

function checkFnKey(): Check {
  const s = fnKeyStatus()
  if (s.running) return result('ok', s.detail)
  return result(s.loaded ? 'degraded' : 'unconfigured', s.detail)
}

export async function runHealthChecks(ctx: HealthContext): Promise<ServiceHealth[]> {
  const checks: Record<ServiceKey, Promise<Check> | Check> = {
    bridge: checkBridge(ctx),
    sqlite: ctx.storeOpen
      ? result('ok', 'Opened and migrated.')
      : result('down', 'The local store failed to open.'),
    daytona: keyed(['DAYTONA_API_KEY'], 3, 'Daytona'),
    sandboxImage: result(
      'pending',
      'The Aegis snapshot is built with pnpm build:sandbox (milestone 3).'
    ),
    docker: checkDocker(),
    droid: keyed(['FACTORY_API_KEY'], 4, 'Droid'),
    photon: keyed('PHOTON_', 5, 'Photon'),
    chalk: keyed('CHALK_', 6, 'Chalk'),
    safeBrowsing: checkSafeBrowsing(),
    downloads: checkDownloads(),
    fnKey: checkFnKey()
  }
  const keys = Object.keys(checks) as ServiceKey[]
  const values = await Promise.all(keys.map((k) => checks[k]))
  const checkedAt = new Date().toISOString()
  return keys.map((key, i) => ({
    key,
    name: SERVICE_NAMES[key],
    required: REQUIRED.includes(key),
    checkedAt,
    ...values[i]
  }))
}
