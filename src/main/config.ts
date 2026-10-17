// Secrets and config, loaded in the main process only. Never sent to the renderer or extension.

import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_SANDBOX_CONCURRENCY,
  DEFAULT_SANDBOX_DAILY_BUDGET
} from '@shared/constants'

/**
 * Loads `.env.local` then `.env`, from the project root in dev or from userData when packaged.
 * Node never overwrites a variable that is already set, so `.env.local` wins over `.env`, and the
 * real environment wins over both. Returns the files that were found.
 */
export function loadEnv(): string[] {
  const dir = app.isPackaged ? app.getPath('userData') : app.getAppPath()
  const loaded: string[] = []
  for (const name of ['.env.local', '.env']) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    process.loadEnvFile(path)
    loaded.push(path)
  }
  return loaded
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
