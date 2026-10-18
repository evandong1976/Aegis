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
import { scriptedAgent, type LiveAgent } from './liveAgent'
import { startSandboxScan, type SandboxScanInput } from './sandboxScan'
import type { SandboxClient, SandboxSession, SampleMeta } from './daytona'
import { droidAgent } from './droidAgent'
import { FILE_TYPE_REFERENCE, INSPECTOR_SOURCE, REFERENCE_ROWS } from './droidAssets'
import { prepareToolkit } from './droidToolkit'
import { findDroidCli } from './sponsors'
import { WORKER_TIMEOUT_MS, type SandboxAnalysis } from './scans'
import { FAKE_INSTALLER } from './testSamples'
import { ScanService } from './scans'
import { runWorkerB, workerBConfigured } from './workerB'
import { createQuarantine } from './quarantine'
import { createDeliveredLedger, startWatcher, type Watcher } from './watcher'

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
let scans: ScanService | null = null
let watcher: Watcher | null = null
let daytona: SandboxClient | null = null

/** Daytona's client, made on first use; null without DAYTONA_API_KEY. */
async function sandboxClient(): Promise<SandboxClient | null> {
  if (!config.has('DAYTONA_API_KEY')) return null
  if (!daytona) {
    const { Daytona } = await import('@daytona/sdk')
    daytona = new Daytona() as unknown as SandboxClient
  }
  return daytona
}

let droidCli: Promise<string | null> | null = null

/** The droid CLI when FACTORY_API_KEY is set and the CLI is installed, looked up once. */
function droidPath(): Promise<string | null> {
  droidCli ??= process.env.FACTORY_API_KEY ? findDroidCli() : Promise.resolve(null)
  return droidCli
}

/** Droid as the analyst, with the file-type reference (droidAssets.ts); null CLI = rules only. */
function analyst(execPath: string | null): LiveAgent {
  return droidAgent({
    execPath,
    apiKey: process.env.FACTORY_API_KEY,
    reference: FILE_TYPE_REFERENCE
  })
}

/**
 * Worker A for downloads: Droid reviews the file in its sandbox with the tools for its type. The
 * sample isn't run here, only read. Without Droid, the inspector's checks still decide (never
 * Clean on their own).
 */
async function analyzeDownload(
  session: SandboxSession,
  sample: SampleMeta
): Promise<SandboxAnalysis> {
  const kit = await prepareToolkit(session, {
    filename: sample.filename,
    inspector: INSPECTOR_SOURCE,
    rows: REFERENCE_ROWS
  })
  const result = await analyst(await droidPath()).review({
    filename: sample.filename,
    meta: sample,
    observation: null,
    tools: kit.tools,
    match: kit.match,
    notes: kit.problem ? [kit.problem] : [],
    runTool: async (name) => {
      const spec = kit.tools.find((t) => t.name === name)
      if (!spec) throw new Error(`no tool named ${name}`)
      const res = await session.exec(`droid tool ${name}`, spec.command, spec.timeoutS ?? 15)
      return { exitCode: res.exitCode, output: res.result }
    },
    emit: () => undefined
  })
  return {
    verdict: result.report.verdict,
    summary: result.report.summary,
    reasons: result.reasons,
    droid: result.report,
    findings: result.findings,
    capabilities: result.capabilities,
    code: result.code
  }
}

/** Where downloads land. AEGIS_DOWNLOADS_DIR points tests and verification runs elsewhere. */
function downloadsDir(): string {
  return process.env.AEGIS_DOWNLOADS_DIR
    ? resolve(process.env.AEGIS_DOWNLOADS_DIR)
    : app.getPath('downloads')
}

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
async function sandboxScan(
  input: SandboxScanInput
): Promise<{ scanId: string } | { error: string }> {
  if (!store) return { error: 'The local store is not open.' }
  if (!process.env.DAYTONA_API_KEY) {
    return { error: 'DAYTONA_API_KEY not set. Add it to .env.local, then restart Aegis.' }
  }
  const db = store
  // Droid when it is set up; otherwise the scripted stand-in, which the live view labels.
  const execPath = await droidPath()
  const { scanId } = startSandboxScan(
    {
      client: async () => {
        const { Daytona } = await import('@daytona/sdk')
        return new Daytona() as unknown as SandboxClient
      },
      bus: live,
      agent: execPath ? analyst(execPath) : scriptedAgent(),
      toolkit: execPath ? { inspector: INSPECTOR_SOURCE, rows: REFERENCE_ROWS } : undefined,
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
  // Downloads (milestone 3): the extension's in-memory bytes and files found in ~/Downloads both
  // go through ScanService. Held files live in the app's own quarantine, never in ~/Downloads.
  const ledger = createDeliveredLedger()
  scans = new ScanService({
    putScan: (report, extra) => {
      store?.putScan(report, extra)
      send('scans:changed', { id: report.id })
    },
    quarantine: createQuarantine(join(app.getPath('userData'), 'quarantine')),
    downloadsDir: downloadsDir(),
    ledger,
    sandboxClient,
    snapshot: process.env.AEGIS_DAYTONA_SNAPSHOT || undefined,
    mode: () => status.mode,
    takeSandboxJob: () => store?.takeSandboxJob(getSettings(store).sandboxDailyBudget) ?? false,
    concurrency: config.sandboxConcurrency,
    analyze: analyzeDownload,
    // Droid's review (DROID_TIMEOUT_MS) comes on top of the sandbox's own steps.
    workerTimeoutMs: WORKER_TIMEOUT_MS + 120_000,
    // Worker B: Chalk sandbox + GPT through Chalk's Model Gateway (chalk/aegis_worker_b).
    workerB: workerBConfigured()
      ? (bytes, meta) =>
          runWorkerB(bytes, meta, {
            root: app.getAppPath(),
            onLine: (line) => status.record(null, `worker B ${line}`)
          })
      : undefined,
    log: (level, text) => status.record(level, text),
    onActive: (count) => {
      status.activeScans = count
      status.changed()
      if (count > 0 && store && getSettings(store).panelAutoPop) showPanel()
    }
  })
  if (getSettings(store).watchDownloads && !status.demo) {
    // Files that arrived while Aegis was closed are picked up too (MEGA_PROMPT §5.1).
    const lastSeen = Number(store.getSetting('watcherSeenAt') ?? NaN)
    const markSeen = (): void => store?.setSetting('watcherSeenAt', String(Date.now()))
    watcher = startWatcher({
      dir: downloadsDir(),
      delivered: ledger,
      since: Number.isFinite(lastSeen) ? lastSeen : undefined,
      onFile: async (file) => {
        if (status.isPaused()) return
        if (!file.needsScan) {
          status.record(null, `watcher skip name=${file.name} reason="${file.reason}"`)
          return
        }
        status.record('warn', `watcher found name=${file.name} reason="${file.reason}"`)
        await scans?.fromPath({ path: file.path, source: 'watcher' })
      },
      onError: (err) => status.record('warn', `watcher error=${String(err)}`)
    })
    markSeen()
    setInterval(markSeen, HEALTH_INTERVAL_MS)
    status.record(null, `watcher started dir=${downloadsDir()}`)
  }

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
      },
      download: (bytes, meta) => scans!.fromChrome(bytes, meta),
      downloadQuarantined: (req) =>
        scans!.fromPath({
          path: req.path,
          source: 'chrome',
          url: req.url,
          referrer: req.referrer,
          filename: req.filename
        }),
      scanStatus: (id) => scans?.status(id) ?? null
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
    const reportId = (): string | undefined =>
      pick ? store?.listScans({ kind: 'any', search: pick, limit: 1 })[0]?.id : undefined
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
  watcher?.stop()
  if (watcher) store?.setSetting('watcherSeenAt', String(Date.now()))
  bridge?.close()
  store?.close()
})
