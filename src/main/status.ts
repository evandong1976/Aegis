// Single source of truth for the app's live status. The tray, panel and bridge read from here.
// Also keeps the scan log: raw lines, as the scanners report them, newest last.

import { EventEmitter } from 'events'
import type {
  AppStatus,
  LogEntry,
  PageSnapshot,
  ProtectionState,
  ServiceHealth
} from '@shared/types'
import { PAUSE_MS } from '@shared/constants'

const LOG_LIMIT = 500

class StatusHub extends EventEmitter {
  health: ServiceHealth[] = []
  pausedUntil: number | null = null
  extensionLastSeen: number | null = null
  activeScans = 0
  mode: 'block' | 'warn' = 'block'
  demo = false
  page: PageSnapshot | null = null
  private log: LogEntry[] = []
  private pauseTimer: NodeJS.Timeout | null = null

  protection(): ProtectionState {
    if (this.pausedUntil && this.pausedUntil > Date.now()) return 'paused'
    if (this.health.some((h) => h.required && h.state !== 'ok' && h.state !== 'pending')) {
      return 'degraded'
    }
    if (this.activeScans > 0) return 'scanning'
    return 'protected'
  }

  get(): AppStatus {
    return {
      protection: this.protection(),
      pausedUntil: this.pausedUntil ? new Date(this.pausedUntil).toISOString() : null,
      mode: this.mode,
      health: this.health,
      activeScans: this.activeScans,
      extensionLastSeen: this.extensionLastSeen
        ? new Date(this.extensionLastSeen).toISOString()
        : null,
      demo: this.demo,
      page: this.page
    }
  }

  changed(): void {
    this.emit('changed', this.get())
  }

  pause(): void {
    this.pausedUntil = Date.now() + PAUSE_MS
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    this.pauseTimer = setTimeout(() => this.resume(), PAUSE_MS)
    this.record('warn', 'protection paused minutes=15')
    this.changed()
  }

  resume(): void {
    const wasPaused = this.pausedUntil !== null
    this.pausedUntil = null
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    this.pauseTimer = null
    if (wasPaused) this.record(null, 'protection resumed')
    this.changed()
  }

  isPaused(): boolean {
    return this.protection() === 'paused'
  }

  /** Appends a raw log line and pushes it to open windows. */
  record(level: LogEntry['level'], text: string, at = new Date().toISOString()): void {
    const entry = { at, level, text }
    this.log.push(entry)
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT)
    this.emit('log', entry)
  }

  seedLog(entries: LogEntry[]): void {
    this.log = [...entries, ...this.log].slice(-LOG_LIMIT)
  }

  recent(limit = 50): LogEntry[] {
    return this.log.slice(-limit)
  }
}

export const status = new StatusHub()
