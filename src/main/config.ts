// Secrets and config, loaded in the main process only. Never sent to the renderer or extension.

import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_SANDBOX_CONCURRENCY,
  DEFAULT_SANDBOX_DAILY_BUDGET
} from '@shared/constants'

/** Loads `.env` from the project root in dev, or from userData when packaged. */
export function loadEnv(): string | null {
  const path = app.isPackaged
    ? join(app.getPath('userData'), '.env')
    : join(app.getAppPath(), '.env')
  if (!existsSync(path)) return null
  process.loadEnvFile(path)
  return path
}

function int(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const config = {
  get bridgePort(): number {
    return int('AEGIS_BRIDGE_PORT', DEFAULT_BRIDGE_PORT)
  },
  get defaultMode(): 'block' | 'warn' {
    return process.env.AEGIS_MODE === 'warn' ? 'warn' : 'block'
  },
  get sandboxDailyBudget(): number {
    return int('AEGIS_SANDBOX_DAILY_BUDGET', DEFAULT_SANDBOX_DAILY_BUDGET)
  },
  get sandboxConcurrency(): number {
    return int('AEGIS_SANDBOX_CONCURRENCY', DEFAULT_SANDBOX_CONCURRENCY)
  },
  /** True if every named variable is set and non-empty. */
  has(...names: string[]): boolean {
    return names.every((n) => (process.env[n] ?? '').trim() !== '')
  },
  /** True if any variable with this prefix is set. */
  hasPrefix(prefix: string): boolean {
    return Object.entries(process.env).some(
      ([k, v]) => k.startsWith(prefix) && (v ?? '').trim() !== ''
    )
  }
}
