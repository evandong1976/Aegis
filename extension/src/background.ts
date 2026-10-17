// Service worker: events only. Long work (download fetches, waiting on verdicts, the bridge
// heartbeat) lives in the offscreen document, because Chrome stops an idle worker after ~30 s.

import { fetchStatus } from './bridge'

const OFFSCREEN_URL = 'offscreen.html'

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

chrome.runtime.onInstalled.addListener(() => void ensureOffscreen().then(updateBadge))
chrome.runtime.onStartup.addListener(() => void ensureOffscreen().then(updateBadge))

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === 'bridge-changed') {
    void updateBadge()
    sendResponse({ ok: true })
  }
  return false
})

// The worker may have been restarted: make sure the offscreen document still exists.
void ensureOffscreen()
