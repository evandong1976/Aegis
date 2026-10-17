// Aegis main process: a menu bar app with no Dock icon. Closing windows never quits; only the
// tray's Quit does. Order matters: identity first (macOS ties permission grants to it).

import { app, BrowserWindow, dialog, globalShortcut } from 'electron'
import { rmSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import type { Server } from 'http'
import { APP_ID, HEALTH_INTERVAL_MS } from '@shared/constants'
import { LIVE_SAMPLES, type LiveSampleKey } from '@shared/live'
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
import { LinkService } from './linkService'
import { refreshFeeds } from './linkData'
import { registeredDomain } from './links'
import { SHORTENERS } from './linkLists'
import { LiveBus } from './live'
import { scriptedAgent } from './liveAgent'
import { startSandboxScan, type SandboxScanInput } from './sandboxScan'
import type { SandboxClient } from './daytona'
import { FAKE_INSTALLER } from './testSamples'

/** The threat feeds are downloaded again this often (MEGA_PROMPT §5.2: cached for an hour). */
const FEED_REFRESH_MS = 60 * 60 * 1000

app.setName('Aegis')
app.setAppUserModelId(APP_ID)
// Dev only: a separate profile (own database, own single-instance lock) for headless captures.
if (process.env.AEGIS_USER_DATA) app.setPath('userData', resolve(process.env.AEGIS_USER_DATA))

if (!app.requestSingleInstanceLock()) app.quit()

let store: Store | null = null
let bridge: Server | null = null
let links: LinkService | null = null

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

// The live view (feature/visualization): every sandbox scan's events, pushed to the windows.
const live = new LiveBus((scanId, event) => send('live:event', { scanId, event }))

/**
 * Opens a caught file in a real network-off sandbox with the live view on screen. Milestone 3's
 * `/download` route will call this with the intercepted bytes; until then the Downloads screen's
 * "Test the sandbox" button sends a built-in harmless sample.
 */
function sandboxScan(input: SandboxScanInput): { scanId: string } | { error: string } {
  if (!store) return { error: 'The local store is not open.' }
  if (!process.env.DAYTONA_API_KEY) {
    return { error: 'DAYTONA_API_KEY not set. Add it to .env.local, then restart Aegis.' }
  }
  const db = store
  const { scanId } = startSandboxScan(
    {
      client: async () => {
        const { Daytona } = await import('@daytona/sdk')
        return new Daytona() as unknown as SandboxClient
      },
      bus: live,
      agent: scriptedAgent(),
      snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || undefined,
      putScan: (report) => {
        db.putScan(report, { fileCategory: 'Scripts', caughtBy: 'Sandbox' })
        send('scans:changed', { id: report.id })
      },
      log: (level, text) => status.record(level, text),
      active: (delta) => {
        status.activeScans = Math.max(0, status.activeScans + delta)
        status.changed()
      }
    },
    input
  )
  openMainWindow('report', scanId)
  return { scanId }
}

async function startTestRun(
  sample: LiveSampleKey
): Promise<{ scanId: string } | { error: string }> {
  const bytes =
    sample === 'terminal-demo'
      ? await readFile(join(app.getAppPath(), 'demo', 'aegis-terminal-demo.command'))
      : Buffer.from(FAKE_INSTALLER)
  return sandboxScan({
    bytes,
    filename: LIVE_SAMPLES[sample].filename,
    url: null,
    referrer: null,
    contentType: 'text/x-shellscript',
    source: 'chrome',
    seenIn: 'Sandbox test'
  })
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

  links = new LinkService({
    isPaused: () => status.isPaused(),
    trustedDomains: () => new Set(store?.listTrusted().map((t) => t.domain) ?? []),
    putScan: (report) => {
      store?.putScan(report)
      send('scans:changed', { id: report.id })
    },
    log: (level, text) => status.record(level, text),
    onPage: (page) => {
      status.page = page
      status.changed()
    },
    onBlocked: () => {
      if (store && getSettings(store).panelAutoPop) showPanel()
    }
  })
  // Feeds load in the background; until they arrive the feed check reports "skipped".
  const feedLog = (text: string, ok: boolean): void => status.record(ok ? null : 'warn', text)
  void refreshFeeds(feedLog)
  setInterval(() => void refreshFeeds(feedLog), FEED_REFRESH_MS)

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
      page: (req) => links!.check(req),
      click: (req) => links!.click(req),
      trust: (input) => {
        // Trust the registered domain, never a shortener (it would trust every link behind it).
        const domain = registeredDomain(input) ?? input.toLowerCase()
        if (SHORTENERS.has(domain)) throw new Error(`${domain} is a link shortener`)
        store?.addTrusted(domain)
        links?.forgetDomain(domain)
        status.record(null, `trust domain=${domain}`)
        send('scans:changed', { id: '' })
        return domain
      }
    })
    status.record(null, `bridge listening host=127.0.0.1 port=${config.bridgePort}`)
  } catch (err) {
    console.error('[bridge] failed to start', err)
    status.record('block', `bridge failed port=${config.bridgePort} error=${String(err)}`)
  }

  registerIpc(store, refreshHealth, (domain) => links?.forgetDomain(domain), {
    get: (scanId) => live.get(scanId),
    start: startTestRun
  })
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
    const sample = process.env.AEGIS_CAPTURE_LIVE as LiveSampleKey | undefined
    scheduleCapture({
      main: getMainWindow,
      panel: getPanel,
      reportId,
      live: sample
        ? { start: () => startTestRun(sample), finished: (id) => live.get(id)?.finished ?? false }
        : undefined
    })
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
