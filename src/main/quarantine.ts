// Quarantine for files Aegis takes out of ~/Downloads (MEGA_PROMPT §5.7). Each file moves into its
// own folder under ~/Library/Application Support/Aegis/quarantine/, gets a `.aegis` extension so a
// double-click can't open it, and loses its execute permissions (files 600, folders 700). A move
// keeps the macOS quarantine attribute. `entry.json` beside it records where it came from, so it
// can go back to its original path and name, or be deleted for good.
//
// Groundwork for milestone 8: not wired to the watcher or the Report actions yet (docs/PLAN.md
// decision 12 and › Branches).

import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { chmod, cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, extname, join, relative } from 'path'
import { promisify } from 'util'
import { QUARANTINE_EXTENSION } from '@shared/constants'

export interface QuarantineEntry {
  id: string
  /** Where it was, and where `restore` puts it back. */
  originalPath: string
  /** Its original file name. */
  name: string
  /** Where it is now, inside the quarantine. */
  path: string
  /** `bundle` for folders such as `.app`. */
  kind: 'file' | 'bundle'
  size: number
  /** Files only. */
  sha256: string | null
  /** Permission bits before quarantine, by path relative to the item ('' is the item itself). */
  modes: Record<string, number>
  quarantinedAt: string
}

export interface Quarantine {
  /** Moves `src` into quarantine as `id`. `originalPath` overrides where `restore` puts it back. */
  add(src: string, id: string, opts?: { originalPath?: string }): Promise<QuarantineEntry>
  get(id: string): Promise<QuarantineEntry | null>
  list(): Promise<QuarantineEntry[]>
  /** Moves it back with its permissions, to `to` or its original path, never over another file. */
  restore(id: string, opts?: { to?: string }): Promise<string>
  /** Deletes it for good. */
  remove(id: string): Promise<void>
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const SIDECAR = 'entry.json'

export function createQuarantine(root: string): Quarantine {
  const folder = (id: string): string => {
    if (!ID.test(id)) throw new Error(`Invalid quarantine id: ${id}`)
    return join(root, id)
  }

  async function get(id: string): Promise<QuarantineEntry | null> {
    try {
      return JSON.parse(await readFile(join(folder(id), SIDECAR), 'utf8')) as QuarantineEntry
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  return {
    async add(src, id, opts = {}) {
      const dir = folder(id)
      const info = await lstat(src)
      if (info.isSymbolicLink()) throw new Error(`Refusing to quarantine a symlink: ${src}`)
      if (!info.isFile() && !info.isDirectory()) throw new Error(`Not a file or folder: ${src}`)
      const kind = info.isDirectory() ? 'bundle' : 'file'
      const originalPath = opts.originalPath ?? src
      const name = basename(originalPath)

      await mkdir(root, { recursive: true, mode: 0o700 })
      await mkdir(dir, { mode: 0o700 })
      const modes = await readModes(src)
      const size = kind === 'file' ? info.size : await treeSize(src)
      const sha256 = kind === 'file' ? await sha256File(src) : null
      const dest = join(dir, withQuarantineExtension(name))
      await move(src, dest)
      await lockDown(dest)

      const entry: QuarantineEntry = {
        id,
        originalPath,
        name,
        path: dest,
        kind,
        size,
        sha256,
        modes,
        quarantinedAt: new Date().toISOString()
      }
      await writeFile(join(dir, SIDECAR), JSON.stringify(entry, null, 2), { mode: 0o600 })
      return entry
    },

    get,

    async list() {
      let ids: string[]
      try {
        ids = await readdir(root)
      } catch (err) {
        if (isMissing(err)) return []
        throw err
      }
      const entries = await Promise.all(ids.filter((id) => ID.test(id)).map(get))
      return entries.filter((e): e is QuarantineEntry => e !== null)
    },

    async restore(id, opts = {}) {
      const entry = await get(id)
      if (!entry) throw new Error(`Nothing in quarantine as ${id}`)
      const target = await freePath(opts.to ?? entry.originalPath)
      await applyModes(entry.path, entry.modes)
      await move(entry.path, target)
      await rm(folder(id), { recursive: true, force: true })
      return target
    },

    async remove(id) {
      await rm(folder(id), { recursive: true, force: true })
    }
  }
}

/** `invoice.pdf` → `invoice.pdf.aegis`; a name that already ends in `.aegis` is kept. */
export function withQuarantineExtension(name: string): string {
  return name.endsWith(QUARANTINE_EXTENSION) ? name : name + QUARANTINE_EXTENSION
}

/** `path`, or `name (1).ext`, `name (2).ext`… beside it, whichever doesn't exist yet. */
export async function freePath(path: string): Promise<string> {
  const ext = extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? path : `${stem} (${n})${ext}`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`No free name for ${path}`)
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** rename(2) keeps extended attributes, including com.apple.quarantine. */
async function move(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    // Different volumes. macOS cp -Rp keeps permissions and extended attributes.
    if (process.platform === 'darwin') await promisify(execFile)('/bin/cp', ['-Rp', src, dest])
    else await cp(src, dest, { recursive: true, preserveTimestamps: true })
    await rm(src, { recursive: true, force: true })
  }
}

/**
 * Files 600, folders 700: nothing in quarantine is executable. Symlinks are skipped: chmod follows
 * them, and a bundle's link could point anywhere on the Mac.
 */
async function lockDown(path: string): Promise<void> {
  for (const { full, isDir, isLink } of await walk(path)) {
    if (!isLink) await chmod(full, isDir ? 0o700 : 0o600)
  }
}

async function readModes(path: string): Promise<Record<string, number>> {
  const modes: Record<string, number> = {}
  for (const { full, mode, isLink } of await walk(path)) {
    if (!isLink) modes[relative(path, full)] = mode & 0o7777
  }
  return modes
}

async function applyModes(path: string, modes: Record<string, number>): Promise<void> {
  // Deepest first, so a folder stays writable until everything inside it is done.
  const items = Object.entries(modes).sort(([a], [b]) => b.length - a.length)
  for (const [rel, mode] of items) await chmod(rel ? join(path, rel) : path, mode)
}

async function treeSize(path: string): Promise<number> {
  let total = 0
  for (const { size, isDir, isLink } of await walk(path)) if (!isDir && !isLink) total += size
  return total
}

interface Item {
  full: string
  isDir: boolean
  isLink: boolean
  mode: number
  size: number
}

/** The item and everything under it, without following symlinks. */
async function walk(path: string): Promise<Item[]> {
  const info = await lstat(path)
  const out: Item[] = [
    {
      full: path,
      isDir: info.isDirectory(),
      isLink: info.isSymbolicLink(),
      mode: info.mode,
      size: info.size
    }
  ]
  if (info.isDirectory()) {
    for (const child of await readdir(path)) out.push(...(await walk(join(path, child))))
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (err) {
    if (isMissing(err)) return false
    throw err
  }
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}
