// Typed IPC between the main process and the renderer (via the preload API).

import type { AppStatus, LogEntry, ScanReport, ScanSummary, ServiceHealth } from './types'

export interface Settings {
  mode: 'block' | 'warn'
  /** Detonate suspicious links, shorteners and new domains automatically (MEGA_PROMPT §5.3). */
  autoDetonate: boolean
  /** Quarantine and scan files other apps drop in ~/Downloads (MEGA_PROMPT §5.7). */
  watchDownloads: boolean
  panelAutoPop: boolean
  alertTexts: boolean
  sandboxDailyBudget: number
}

export interface TrustedSite {
  domain: string
  addedAt: string
}

export interface EvalResults {
  ranAt: string
  datasets: Record<string, { size: number }>
  configurations: Array<{
    name: string
    precision: number
    recall: number
    falseAlarmRate: number
    msPerVerdict: number
  }>
}

export type LinkTab = 'held' | 'blocked' | 'allowed' | 'all'
export type FileTab = 'held' | 'quarantined' | 'delivered' | 'all'

export interface ScanQuery {
  kind: 'link' | 'file' | 'any'
  tab?: LinkTab | FileTab
  /** Matches URL, file name or SHA-256. */
  search?: string
  limit?: number
}

export interface DayCounts {
  linksChecked: number
  linksBlocked: number
  linksHeld: number
  filesScanned: number
  filesHeld: number
  filesQuarantined: number
  filesSandboxed: number
  /** Median time from received to verdict, links only. */
  linkMedianMs: number | null
}

export interface OverviewStats {
  today: DayCounts
  yesterday: DayCounts
  /** Daily counts for the last 8 days, oldest first, for sparklines. */
  spark: { links: number[]; files: number[] }
  /** Items waiting on the user: the nav rail counts. */
  waiting: { links: number; files: number }
  tabCounts: { links: Record<LinkTab, number>; files: Record<FileTab, number> }
  /** Which engine returned the file verdict, today. */
  caughtBy: Array<{ engine: string; files: number }>
  /** Files scanned today by category. */
  byType: Array<{ category: string; files: number }>
}

export type MainRoute =
  'overview' | 'links' | 'downloads' | 'messages' | 'accuracy' | 'settings' | 'report'

/** Request/response calls: `ipcRenderer.invoke(channel, ...args)`. */
export interface IpcInvoke {
  'status:get': { args: []; result: AppStatus }
  'health:refresh': { args: []; result: ServiceHealth[] }
  'overview:get': { args: []; result: OverviewStats }
  'scans:list': { args: [query: ScanQuery]; result: ScanSummary[] }
  'scans:get': { args: [id: string]; result: ScanReport | null }
  'log:list': { args: [limit?: number]; result: LogEntry[] }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }
  'trusted:list': { args: []; result: TrustedSite[] }
  'trusted:remove': { args: [domain: string]; result: TrustedSite[] }
  'evals:get': { args: []; result: EvalResults | null }
  'protection:pause': { args: []; result: AppStatus }
  'protection:resume': { args: []; result: AppStatus }
  /** Retries the fn key after Input Monitoring is granted; opens the System Settings pane if not. */
  'fnkey:retry': { args: []; result: ServiceHealth[] }
}

/** Fire-and-forget calls: `ipcRenderer.send(channel, ...args)`. */
export interface IpcSend {
  'panel:hide': []
  'main:open': [route?: MainRoute, scanId?: string]
}

/** Main → renderer pushes: `webContents.send(channel, payload)`. */
export interface IpcEvents {
  'status:changed': AppStatus
  'scans:changed': { id: string }
  'log:appended': LogEntry
  navigate: { route: MainRoute; scanId?: string }
}

export type InvokeChannel = keyof IpcInvoke
export type SendChannel = keyof IpcSend
export type EventChannel = keyof IpcEvents

export const INVOKE_CHANNELS: InvokeChannel[] = [
  'status:get',
  'health:refresh',
  'overview:get',
  'scans:list',
  'scans:get',
  'log:list',
  'settings:get',
  'settings:set',
  'trusted:list',
  'trusted:remove',
  'evals:get',
  'protection:pause',
  'protection:resume',
  'fnkey:retry'
]
export const SEND_CHANNELS: SendChannel[] = ['panel:hide', 'main:open']
export const EVENT_CHANNELS: EventChannel[] = [
  'status:changed',
  'scans:changed',
  'log:appended',
  'navigate'
]

export interface AegisApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: IpcInvoke[C]['args']
  ): Promise<IpcInvoke[C]['result']>
  send<C extends SendChannel>(channel: C, ...args: IpcSend[C]): void
  /** Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void
  platform: string
}
