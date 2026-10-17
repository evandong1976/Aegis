// Offscreen document: lives as long as Chrome does, so it owns long-running work.
// For now it keeps the bridge heartbeat so the app knows the extension is connected.

import { ping } from './bridge'

const HEARTBEAT_MS = 30_000
let connected: boolean | null = null

async function beat(): Promise<void> {
  const ok = await ping()
  if (ok !== connected) {
    connected = ok
    // Tell the worker so it can update the toolbar badge.
    void chrome.runtime.sendMessage({ type: 'bridge-changed', connected: ok }).catch(() => {})
  }
}

void beat()
setInterval(() => void beat(), HEARTBEAT_MS)
