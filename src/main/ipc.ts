// IPC handlers for the preload API. Channel names and types live in src/shared/ipc.ts.

import { app, ipcMain, shell } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { EvalResults, IpcInvoke, InvokeChannel, MainRoute } from '@shared/ipc'
import { status } from './status'
import { getSettings, setSettings } from './settings'
import type { Store } from './store'
import { hidePanel } from './panel'
import { openMainWindow } from './windows'
import { retryFnKey } from './fnkey'
import type { LiveTrigger } from './sponsors'

type Handler<C extends InvokeChannel> = (
  ...args: IpcInvoke[C]['args']
) => IpcInvoke[C]['result'] | Promise<IpcInvoke[C]['result']>

function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as IpcInvoke[C]['args'])))
}

async function readEvalResults(): Promise<EvalResults | null> {
  try {
    const raw = await readFile(join(app.getAppPath(), 'evals', 'results.json'), 'utf8')
    return JSON.parse(raw) as EvalResults
  } catch {
    return null
  }
}

export function registerIpc(
  store: Store,
  refreshHealth: (live?: LiveTrigger) => Promise<void>
): void {
  handle('status:get', () => status.get())
  // Check now: also runs the Daytona and Droid live tests (sponsors.ts).
  handle('health:refresh', async () => {
    await refreshHealth('manual')
    return status.health
  })
  handle('overview:get', () => store.overview())
  handle('scans:list', (query) => store.listScans(query))
  handle('scans:get', (id) => store.getScan(id))
  handle('log:list', (limit = 50) => status.recent(Math.min(Math.max(limit, 1), 500)))
  handle('settings:get', () => getSettings(store))
  handle('settings:set', (patch) => {
    const next = setSettings(store, patch)
    status.mode = next.mode
    status.changed()
    return next
  })
  handle('trusted:list', () => store.listTrusted())
  handle('trusted:remove', (domain) => {
    store.removeTrusted(domain)
    return store.listTrusted()
  })
  handle('evals:get', () => readEvalResults())
  handle('protection:pause', () => {
    status.pause()
    return status.get()
  })
  handle('protection:resume', () => {
    status.resume()
    return status.get()
  })
  handle('fnkey:retry', async () => {
    const fn = retryFnKey()
    if (fn.loaded && !fn.running) {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
      )
    }
    await refreshHealth()
    return status.health
  })

  ipcMain.on('panel:hide', () => hidePanel())
  ipcMain.on('main:open', (_event, route?: MainRoute, scanId?: string) => {
    hidePanel()
    openMainWindow(route, scanId)
  })
}
