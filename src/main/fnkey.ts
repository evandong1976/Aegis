// The fn/globe key (MEGA_PROMPT §5.8). Electron's globalShortcut can't bind fn, so a native
// add-on (native/fn-key, adapted from Klair) reports clean taps via a listen-only CGEventTap.
// If the add-on isn't built or Input Monitoring isn't granted, ⌃⌥A keeps working; nothing breaks.
//
// Add-on contract: start(cb: (event: 'tap') => void): boolean; stop(): void. start() also asks
// macOS for Input Monitoring when it isn't granted, which is what lists the app in System Settings.

import { join } from 'path'
import { app } from 'electron'

interface FnAddon {
  start(cb: (event: 'tap') => void): boolean
  stop(): void
}

export interface FnKeyStatus {
  /** The add-on file was found and loaded. */
  loaded: boolean
  /** Listening for fn taps (Input Monitoring granted). */
  running: boolean
  detail: string
}

let addon: FnAddon | null = null
let onTap: (() => void) | null = null
let status: FnKeyStatus = { loaded: false, running: false, detail: 'Not started.' }

function load(): FnAddon | null {
  if (addon) return addon
  try {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    addon = require(join(base, 'native', 'fn-key', 'build', 'Release', 'fn_key.node')) as FnAddon
  } catch {
    addon = null
  }
  return addon
}

function tryStart(): FnKeyStatus {
  if (process.platform !== 'darwin') {
    status = { loaded: false, running: false, detail: 'The fn key is macOS-only. Use ⌃⌥A.' }
    return status
  }
  if (status.running || !onTap) return status
  const a = load()
  if (!a) {
    status = {
      loaded: false,
      running: false,
      detail:
        'The fn add-on is not built. Run pnpm build:native, then restart Aegis. ⌃⌥A works meanwhile.'
    }
    return status
  }
  const tap = onTap
  const ok = a.start(() => tap())
  const who = app.isPackaged ? 'Aegis' : 'Electron (under pnpm dev)'
  status = ok
    ? { loaded: true, running: true, detail: 'Tap fn to open and close the panel.' }
    : {
        loaded: true,
        running: false,
        detail: `Input Monitoring is not granted. Allow ${who} in System Settings › Privacy & Security › Input Monitoring, then Check again. ⌃⌥A works meanwhile.`
      }
  return status
}

export function startFnKey(handler: () => void): FnKeyStatus {
  onTap = handler
  return tryStart()
}

/** Try again after Input Monitoring is granted, without restarting. Re-sends the request too. */
export function retryFnKey(): FnKeyStatus {
  return tryStart()
}

export function stopFnKey(): void {
  addon?.stop()
}

export function fnKeyStatus(): FnKeyStatus {
  return status
}
