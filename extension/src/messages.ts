// Messages between the content script and the service worker. The content script never calls
// the bridge itself (MEGA_PROMPT §5.1); the worker forwards to the app and fills in the tab.

import type { ClickRequest, PageResponse } from '@shared/bridge'
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
