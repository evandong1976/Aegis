// Service worker: events only. Long work (download fetches, waiting on verdicts, the bridge
// heartbeat) lives in the offscreen document, because Chrome stops an idle worker after ~30 s.
// It also relays the content script's link checks to the app: content scripts never call the
// bridge directly (MEGA_PROMPT §5.1).

import { fetchStatus, postClick, postPage, postTrust } from './bridge'
import type { ContentMessage, ContentReply, RecentVerdict } from './messages'

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

chrome.runtime.onInstalled.addListener(() => void ensureOffscreen().then(updateBadge))
chrome.runtime.onStartup.addListener(() => void ensureOffscreen().then(updateBadge))

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message?.type === 'bridge-changed') {
    void updateBadge()
    sendResponse({ ok: true })
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
