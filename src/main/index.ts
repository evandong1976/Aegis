// Aegis main process: a menu bar app with no Dock icon. Closing windows never quits; only the
// tray's Quit does. Order matters: identity first (macOS ties permission grants to it).

import { app, BrowserWindow, dialog, globalShortcut } from 'electron'
import { rmSync } from 'fs'
import { join, resolve } from 'path'
import type { Server } from 'http'
import { APP_ID, HEALTH_INTERVAL_MS } from '@shared/constants'
import { startBridge } from './bridge'
import { config, loadEnv } from './config'
import { runHealthChecks } from './health'
import type { LiveTrigger } from './sponsors'
import { registerIpc } from './ipc'
import { getPanel, initPanel, showPanel, togglePanel } from './panel'
import { getSettings } from './settings'
import { status } from './status'
import { openStore, type Store } from './store'
import { DEMO_PAGE, demoLog, seedDemo } from './demo'
import { initTray, updateTray, type TrayActions } from './tray'
import { getMainWindow, openMainWindow, setQuitting } from './windows'
import { scheduleCapture } from './devcapture'
import { startFnKey, stopFnKey } from './fnkey'

app.setName('Aegis')
app.setAppUserModelId(APP_ID)
// Dev only: a separate profile (own database, own single-instance lock) for headless captures.
if (process.env.AEGIS_USER_DATA) app.setPath('userData', resolve(process.env.AEGIS_USER_DATA))

if (!app.requestSingleInstanceLock()) app.quit()

let store: Store | null = null
let bridge: Server | null = null

// Health refreshes run one at a time, so each compares against the previous result. (Startup and
// the extension's first ping used to overlap and log every service twice.)
// `live` (app start, Check now) also runs the Daytona and Droid live tests, which use credits.
let healthChain: Promise<void> = Promise.resolve()
function refreshHealth(live?: LiveTrigger): Promise<void> {
  const once = (): Promise<void> => runHealthOnce(live)
  healthChain = healthChain.then(once, once)
  return healthChain
}

async function runHealthOnce(live?: LiveTrigger): Promise<void> {
  const before = new Map(status.health.map((h) => [h.key, h.state]))
  status.health = await runHealthChecks({
    bridgeListening: bridge?.listening ?? false,
    extensionLastSeen: status.extensionLastSeen,
    storeOpen: store !== null,
    live,
    memory: store
      ? { get: (k) => store?.getSetting(k), set: (k, v) => store?.setSetting(k, v) }
      : undefined
  })
  for (const h of status.health) {
    if (before.get(h.key) === h.state) continue
    const level =
      h.state === 'ok' ? 'allow' : h.state === 'down' ? 'block' : h.required ? 'warn' : null
    status.record(level, `health service=${h.key} state=${h.state}`)
  }
  status.changed()
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const trayActions: TrayActions = {
  openPanel: () => togglePanel(),
  openMain: () => openMainWindow(),
  pause: () => status.pause(),
  resume: () => status.resume(),
  quit: () => {
    setQuitting()
    app.quit()
  }
}

app.whenReady().then(async () => {
  app.dock?.hide()
  loadEnv()

  // AEGIS_DEMO=1 runs on a throwaway database seeded from the Figma demo path (src/main/demo.ts).
  status.demo = process.env.AEGIS_DEMO === '1'
  const dbPath = join(app.getPath('userData'), status.demo ? 'aegis-demo.db' : 'aegis.db')
  if (status.demo) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  }

  try {
    store = openStore(dbPath)
  } catch (err) {
    // Nothing works without the store (BUILD_PROMPT §4.1).
    dialog.showErrorBox('Aegis could not open its local store', String(err))
    app.exit(1)
    return
  }
  status.mode = getSettings(store).mode
  if (status.demo) {
    seedDemo(store)
    status.seedLog(demoLog())
    status.page = DEMO_PAGE
    status.activeScans = store
      .listScans({ kind: 'file' })
      .filter((s) => s.action === 'scanning').length
  }

  try {
    bridge = await startBridge({
      port: config.bridgePort,
      version: app.getVersion(),
      getStatus: () => ({ protection: status.protection(), mode: status.mode }),
      onPing: () => {
        const wasConnected = status.extensionLastSeen !== null
        status.extensionLastSeen = Date.now()
        if (!wasConnected) {
          status.record('allow', 'extension connected')
          void refreshHealth()
        }
      },
      trust: (domain) => {
        store?.addTrusted(domain)
        status.record(null, `trust domain=${domain.toLowerCase()}`)
      }
    })
    status.record(null, `bridge listening host=127.0.0.1 port=${config.bridgePort}`)
  } catch (err) {
    console.error('[bridge] failed to start', err)
    status.record('block', `bridge failed port=${config.bridgePort} error=${String(err)}`)
  }

  registerIpc(store, refreshHealth)
  initTray()
  status.on('changed', () => {
    updateTray(status.get(), trayActions)
    send('status:changed', status.get())
  })
  status.on('log', (entry) => send('log:appended', entry))
  updateTray(status.get(), trayActions)

  // fn (native add-on) and ⌃⌥A both toggle the panel; ⌃⌥A is the fallback and always on.
  if (!globalShortcut.register('Control+Alt+A', togglePanel)) {
    console.warn('[shortcut] ⌃⌥A is taken by another app')
  }
  const fn = startFnKey(togglePanel)
  status.record(fn.running ? 'allow' : 'warn', `fnkey running=${fn.running} loaded=${fn.loaded}`)

  initPanel()
  // Lookups first so the window and tray have a status at once; the live tests follow in the
  // background (a sandbox start and a Droid call can take a while).
  await refreshHealth()
  void refreshHealth('start')
  setInterval(() => void refreshHealth(), HEALTH_INTERVAL_MS)

  // First run: open the main window so setup is visible. Later launches stay in the menu bar.
  if (!store.getSetting('firstRunDone')) {
    store.setSetting('firstRunDone', new Date().toISOString())
    openMainWindow('settings')
  }

  if (process.env.AEGIS_CAPTURE_DIR) {
    // AEGIS_CAPTURE_SCAN picks the scan the report route opens, by file name or URL.
    const pick = process.env.AEGIS_CAPTURE_SCAN
    const reportId = pick
      ? store.listScans({ kind: 'any', search: pick, limit: 1 })[0]?.id
      : undefined
    openMainWindow('overview')
    showPanel()
    scheduleCapture({ main: getMainWindow, panel: getPanel, reportId })
  }
})

app.on('second-instance', () => openMainWindow())

// Keep running with no windows open.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  setQuitting()
  globalShortcut.unregisterAll()
  stopFnKey()
  bridge?.close()
  store?.close()
})
