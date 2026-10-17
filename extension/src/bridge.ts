// Talks to the Aegis app's local bridge. Only the service worker and offscreen document call this;
// content scripts never call the bridge directly (MEGA_PROMPT §5.1).

import { BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from '@shared/constants'
import {
  BRIDGE_ROUTES,
  PageResponseSchema,
  StatusResponseSchema,
  type ClickRequest,
  type PageRequest,
  type PageResponse,
  type PingRequest,
  type StatusResponse
} from '@shared/bridge'

const BASE = `http://${BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`

export async function fetchStatus(timeoutMs = 2000): Promise<StatusResponse | null> {
  try {
    const res = await fetch(BASE + BRIDGE_ROUTES.status.path, {
      method: 'POST',
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

async function post(path: string, body: unknown, timeoutMs: number): Promise<Response | null> {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.ok ? res : null
  } catch {
    return null
  }
}

/** Verdicts for a page's links; null when the app isn't running (links then open as normal). */
export async function postPage(req: PageRequest): Promise<PageResponse | null> {
  // The app waits up to 1.5 s for lookups (4 s at a click); leave room on top.
  const res = await post(BRIDGE_ROUTES.page.path, req, req.urgent ? 8000 : 5000)
  if (!res) return null
  try {
    return PageResponseSchema.parse(await res.json())
  } catch {
    return null
  }
}

export async function postClick(req: ClickRequest): Promise<boolean> {
  return (await post(BRIDGE_ROUTES.click.path, req, 5000)) !== null
}

export async function postTrust(domain: string): Promise<boolean> {
  return (await post(BRIDGE_ROUTES.trust.path, { domain }, 3000)) !== null
}
