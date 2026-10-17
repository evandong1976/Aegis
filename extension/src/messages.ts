// Messages between the content script and the service worker. The content script never calls
// the bridge itself (MEGA_PROMPT §5.1); the worker forwards to the app and fills in the tab.

import type { ClickRequest, PageResponse, ScanStatusResponse } from '@shared/bridge'
import type { Verdict } from '@shared/types'

export type ContentMessage =
  | {
      type: 'aegis:page'
      pageUrl: string
      links: Array<{ href: string; text: string }>
      urgent?: boolean
    }
  /** clickId is left out on the first report; the worker makes one and returns it. */
  | {
      type: 'aegis:click'
      click: Omit<ClickRequest, 'clickId' | 'tabId'> & {
        clickId?: string
        /** Sent with the first report of a click, for the popup's "Recent verdicts". */
        recent?: RecentVerdict
      }
    }
  | { type: 'aegis:trust'; domain: string }
  /** This page's counts for the toolbar badge; null while paused. */
  | { type: 'aegis:counts'; counts: Record<Verdict, number> | null }

export type ContentReply =
  | { type: 'aegis:page'; response: PageResponse }
  | { type: 'aegis:click'; clickId: string }
  | { type: 'aegis:ok' }

/** The last few clicked links, for the popup's "Recent verdicts" (chrome.storage.session). */
export interface RecentVerdict {
  domain: string
  verdict: Verdict
  reason: string
  at: string
}

/** A download the service worker stopped; the offscreen document fetches it into memory. */
export interface InterceptJob {
  downloadId: number
  url: string
  referrer?: string
  /** Chrome's name for it, if it had one yet; the response's own name wins. */
  filename: string
  mime?: string
  /** Bytes, when Chrome knew. */
  size?: number
}

/** Service worker → offscreen document. */
export type WorkerToOffscreen =
  | { type: 'aegis:intercept'; job: InterceptJob }
  /** Poll the app for this scan's verdict (a file that took the quarantine path). */
  | { type: 'aegis:watch-scan'; scanId: string; filename: string }

/** Offscreen document → service worker. */
export type OffscreenToWorker =
  /** The in-memory path didn't work: the worker takes the quarantine path (or lets it through). */
  | {
      type: 'aegis:fetch-failed'
      job: InterceptJob
      filename: string
      reason: 'fetch_failed' | 'too_large' | 'app_down'
    }
  /** A scan started or changed; `final` once it has a verdict (or polling gave up). */
  | {
      type: 'aegis:scan-update'
      scanId: string
      filename: string
      scan: ScanStatusResponse | null
      final: boolean
    }
