// Talks to the Aegis app's local bridge. Only the service worker and offscreen document call this;
// content scripts never call the bridge directly (MEGA_PROMPT §5.1).

import { BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from '@shared/constants'
import {
  BRIDGE_ROUTES,
  StatusResponseSchema,
  type PingRequest,
  type StatusResponse
} from '@shared/bridge'

const BASE = `http://${BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`

export async function fetchStatus(timeoutMs = 2000): Promise<StatusResponse | null> {
  try {
    const res = await fetch(BASE + BRIDGE_ROUTES.status.path, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    return StatusResponseSchema.parse(await res.json())
  } catch {
    return null
  }
}

export async function ping(): Promise<boolean> {
  const body: PingRequest = {
    // Not chrome.runtime.getManifest(): the offscreen document, which sends the heartbeat, can't
    // call it. The build bakes the manifest version in.
    extensionVersion: __AEGIS_EXTENSION_VERSION__,
    at: new Date().toISOString()
  }
  try {
    const res = await fetch(BASE + BRIDGE_ROUTES.ping.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000)
    })
    return res.ok
  } catch {
    return false
  }
}
