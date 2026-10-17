// Service worker: events only. Long work (download fetches, waiting on verdicts, the bridge
// heartbeat) lives in the offscreen document, because Chrome stops an idle worker after ~30 s.
// It also relays the content script's link checks to the app: content scripts never call the
// bridge directly (MEGA_PROMPT §5.1).
//
// Downloads (milestone 3, MEGA_PROMPT §5.1): every new download is paused the moment Chrome
// creates it. If the app is running, it is cancelled and erased, and the offscreen document
// fetches the same URL into memory and hands the bytes to the app, so the file never lands in
// ~/Downloads. If that can't work (a one-time link, a sign-in page instead of the file, over
// 200 MB), Chrome downloads it again into Downloads/.aegis-quarantine/<name>.aegis and the app moves
// it into its own quarantine. If the app isn't running, the download goes ahead, marked "not
// scanned"; the ~/Downloads watcher picks it up when the app starts.

import {
  CHROME_QUARANTINE_DIR,
  IN_MEMORY_DOWNLOAD_LIMIT_BYTES,
  QUARANTINE_EXTENSION
} from '@shared/constants'
import type { QuarantinedRequest } from '@shared/bridge'
import { VERDICTS } from '@shared/verdicts'
import { fetchStatus, postClick, postPage, postQuarantined, postTrust } from './bridge'
import type {
  ContentMessage,
  ContentReply,
  InterceptJob,
  OffscreenToWorker,
  RecentVerdict,
  WorkerToOffscreen
} from './messages'

const OFFSCREEN_URL = 'offscreen.html'
const RECENT_KEY = 'recentVerdicts'

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Streams download bytes to the local Aegis app and keeps its connection alive.'
  })
}

async function updateBadge(): Promise<void> {
  const status = await fetchStatus()
  if (!status) {
    await chrome.action.setBadgeText({ text: '!' })
    await chrome.action.setBadgeBackgroundColor({ color: '#ffb547' })
    await chrome.action.setTitle({ title: 'Aegis: app not running. Downloads are not scanned.' })
    return
  }
  await chrome.action.setBadgeText({ text: status.protection === 'paused' ? '||' : '' })
  await chrome.action.setTitle({ title: `Aegis: ${status.protection}` })
}

/** Per-tab badge: how many risky links this page has (overrides the global badge for the tab). */
async function tabBadge(tabId: number, risky: number | null): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: risky ? String(risky) : '' })
    if (risky) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff6b80' })
  } catch {
    // The tab closed.
  }
}

async function remember(entry: RecentVerdict): Promise<void> {
  const got = await chrome.storage.session.get(RECENT_KEY)
  const list = (got[RECENT_KEY] as RecentVerdict[] | undefined) ?? []
  await chrome.storage.session.set({ [RECENT_KEY]: [entry, ...list].slice(0, 5) })
}

async function handle(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender
): Promise<ContentReply | undefined> {
  const tabId = sender.tab?.id ?? -1
  switch (message.type) {
    case 'aegis:page': {
      const response = await postPage({
        tabId,
        pageUrl: message.pageUrl,
        links: message.links,
        urgent: message.urgent
      })
      return response ? { type: 'aegis:page', response } : undefined
    }
    case 'aegis:click': {
      const { recent, ...click } = message.click
      const clickId = click.clickId ?? crypto.randomUUID()
      const ok = await postClick({ ...click, clickId, tabId })
      if (ok && recent) await remember(recent)
      return ok ? { type: 'aegis:click', clickId } : undefined
    }
    case 'aegis:trust':
      await postTrust(message.domain)
      return { type: 'aegis:ok' }
    case 'aegis:counts':
      if (tabId >= 0) {
        const c = message.counts
        await tabBadge(tabId, c ? c.malicious + c.suspicious : null)
      }
      return { type: 'aegis:ok' }
  }
}

// ── Downloads ───────────────────────────────────────────────────────────────────────────────────

/** Downloads Chrome is writing to disk for us, to hand to the app when they finish. */
const HANDOVER_KEY = 'handover'
type Handover = Omit<QuarantinedRequest, 'chromeDownloadId' | 'path'>

async function handovers(): Promise<Record<string, Handover>> {
  const got = await chrome.storage.session.get(HANDOVER_KEY)
  return (got[HANDOVER_KEY] as Record<string, Handover> | undefined) ?? {}
}

async function setHandover(id: number, value: Handover | null): Promise<void> {
  const all = await handovers()
  if (value) all[id] = value
  else delete all[id]
  await chrome.storage.session.set({ [HANDOVER_KEY]: all })
}

function notify(id: string, title: string, message: string): void {
  void chrome.notifications
    .create(id, { type: 'basic', iconUrl: 'icons/icon-128.png', title, message, priority: 1 })
    .catch(() => {})
}

const quietly = (p: Promise<unknown>): Promise<void> =>
  p.then(
    () => undefined,
    () => undefined
  )

function toOffscreen(message: WorkerToOffscreen): Promise<void> {
  return ensureOffscreen().then(() => quietly(chrome.runtime.sendMessage(message)))
}

/** Gives the app a file Chrome wrote to disk; it moves it into quarantine and scans it. */
async function handOver(item: chrome.downloads.DownloadItem, h: Handover): Promise<void> {
  const name = item.filename.split('/').pop() ?? 'download'
  const scanId = await postQuarantined({ ...h, chromeDownloadId: item.id, path: item.filename })
  if (scanId === undefined) {
    notify(`aegis-dl-${item.id}`, 'Not scanned', `${name}: the Aegis app isn't running.`)
    return
  }
  // The file now lives in the app's quarantine; this history entry points at nothing.
  await quietly(chrome.downloads.erase({ id: item.id }))
  if (scanId) await toOffscreen({ type: 'aegis:watch-scan', scanId, filename: name })
}

/** Fallback: download it again, into Downloads/.aegis-quarantine/<name>.aegis. */
async function quarantinePath(
  job: InterceptJob,
  filename: string,
  reason: QuarantinedRequest['reason']
): Promise<void> {
  if (!/^https?:/i.test(job.url)) {
    notify(`aegis-dl-${job.downloadId}`, 'Download stopped', `Aegis couldn't fetch ${filename}.`)
    return
  }
  const safe = (filename.split(/[\\/]/).pop() || 'download').replace(/^\.+/, '')
  const handover: Handover = { url: job.url, referrer: job.referrer, filename: safe, reason }
  let id: number
  try {
    id = await chrome.downloads.download({
      url: job.url,
      filename: `${CHROME_QUARANTINE_DIR}/${safe}${QUARANTINE_EXTENSION}`,
      conflictAction: 'uniquify',
      saveAs: false
    })
  } catch {
    // Chrome refused the folder name: save it under its own name; the app takes it on completion.
    id = await chrome.downloads.download({ url: job.url, saveAs: false })
  }
  await setHandover(id, handover)
}

async function onDownload(item: chrome.downloads.DownloadItem): Promise<void> {
  // Our own fallback downloads.
  if (item.byExtensionId === chrome.runtime.id) return
  const url = item.finalUrl || item.url
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase()
  if (!['http', 'https', 'data', 'blob'].includes(scheme)) return

  // Stop it first, then decide. A small file may already be finished.
  const paused = await chrome.downloads.pause(item.id).then(
    () => true,
    () => false
  )
  const app = await fetchStatus(1500)
  const job: InterceptJob = {
    downloadId: item.id,
    url,
    referrer: item.referrer || undefined,
    filename: item.filename,
    mime: item.mime || undefined,
    size: item.fileSize > 0 ? item.fileSize : item.totalBytes > 0 ? item.totalBytes : undefined
  }
  const name = item.filename.split('/').pop() || url.split('/').pop() || 'download'

  if (!app || app.protection === 'paused') {
    if (paused) await quietly(chrome.downloads.resume(item.id))
    if (!app) {
      notify(
        `aegis-dl-${item.id}`,
        'Not scanned',
        `${name}: the Aegis app isn't running. It will be checked when Aegis starts.`
      )
    }
    return
  }

  if (!paused) {
    const [now] = await chrome.downloads.search({ id: item.id })
    if (now?.state === 'complete') {
      // Finished before the pause landed: the app moves it into quarantine at once.
      await handOver(now, {
        url,
        referrer: job.referrer,
        filename: name,
        reason: 'already_finished'
      })
      return
    }
  }

  if (scheme === 'blob') {
    // A blob: URL lives only in the page that made it, so it can't be fetched again: let Chrome
    // finish it and hand it over then.
    await setHandover(item.id, {
      url,
      referrer: job.referrer,
      filename: name,
      reason: 'fetch_failed'
    })
    await quietly(chrome.downloads.resume(item.id))
    return
  }

  await quietly(chrome.downloads.cancel(item.id))
  await quietly(chrome.downloads.erase({ id: item.id }))
  if ((job.size ?? 0) > IN_MEMORY_DOWNLOAD_LIMIT_BYTES) {
    await quarantinePath(job, name, 'too_large')
    return
  }
  notify(
    `aegis-dl-${item.id}`,
    'Checking download',
    `Aegis is checking ${name} before it reaches your Mac.`
  )
  await toOffscreen({ type: 'aegis:intercept', job })
}

chrome.downloads.onCreated.addListener((item) => void onDownload(item))

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== 'complete' && delta.state?.current !== 'interrupted') return
  void (async () => {
    const h = (await handovers())[delta.id]
    if (!h) return
    await setHandover(delta.id, null)
    const [item] = await chrome.downloads.search({ id: delta.id })
    if (item?.state === 'complete') await handOver(item, h)
    else
      notify(`aegis-dl-${delta.id}`, 'Download failed', `${h.filename} didn't finish downloading.`)
  })()
})

async function onOffscreen(message: OffscreenToWorker): Promise<void> {
  if (message.type === 'aegis:fetch-failed') {
    const { job, filename, reason } = message
    if (reason === 'app_down') {
      // The app went away mid-fetch: let the download through rather than lose it.
      await quietly(chrome.downloads.download({ url: job.url, saveAs: false }))
      notify(
        `aegis-dl-${job.downloadId}`,
        'Not scanned',
        `${filename}: the Aegis app isn't running.`
      )
      return
    }
    await quarantinePath(job, filename, reason)
    return
  }
  const { scanId, filename, scan, final } = message
  const id = `aegis-scan-${scanId}`
  if (!final) {
    notify(id, 'Checking download', `Aegis is checking ${filename} before it reaches your Mac.`)
    return
  }
  if (!scan || !scan.verdict) {
    notify(id, filename, 'Aegis is still checking this file. Open Aegis for the report.')
    return
  }
  const label = VERDICTS[scan.verdict].label
  const body = scan.held
    ? `Held, not in your Downloads. ${scan.summary ?? ''}`.trim()
    : 'No threats found. Saved to your Downloads.'
  notify(id, `${label}: ${filename}`, body)
  await remember({
    domain: filename,
    verdict: scan.verdict,
    reason: scan.held ? 'Download held' : 'Download delivered',
    at: new Date().toISOString()
  })
}

chrome.runtime.onInstalled.addListener(() => void ensureOffscreen().then(updateBadge))
chrome.runtime.onStartup.addListener(() => void ensureOffscreen().then(updateBadge))

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message?.type === 'bridge-changed') {
    void updateBadge()
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === 'aegis:fetch-failed' || message?.type === 'aegis:scan-update') {
    void onOffscreen(message as OffscreenToWorker)
    return false
  }
  if (typeof message?.type === 'string' && message.type.startsWith('aegis:') && sender.tab) {
    void handle(message as ContentMessage, sender).then(sendResponse, () => sendResponse(undefined))
    return true
  }
  return false
})

// The worker may have been restarted: make sure the offscreen document still exists.
void ensureOffscreen()
