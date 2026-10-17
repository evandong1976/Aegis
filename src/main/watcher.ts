// ~/Downloads watcher (MEGA_PROMPT §5.7): notices files other apps drop into ~/Downloads (Safari,
// Mail, Slack, AirDrop), waits until each stops growing, and says whether it needs a scan. It never
// opens or runs a file; it reads only the first bytes, to confirm a media file is what its name
// says (§5.1: a `photo.jpg` that is really a Mach-O binary gets scanned).
//
// Groundwork for milestone 8: nothing starts it until milestone 3's pipeline exists to take the
// files (docs/PLAN.md › Branches). Moving a file into quarantine is quarantine.ts's job.

import { watch, type FSWatcher } from 'fs'
import { lstat, open, readdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import {
  ALWAYS_SCAN_EXTENSIONS,
  CHROME_QUARANTINE_DIR,
  PASS_THROUGH_EXTENSIONS,
  QUARANTINE_EXTENSION
} from '@shared/constants'
import { sha256File } from './quarantine'

export interface SettledFile {
  path: string
  name: string
  /** `bundle` for folders such as `.app`. */
  kind: 'file' | 'bundle'
  size: number
  needsScan: boolean
  /** Why, for the log: "script", "image, type confirmed", ".jpg file that isn't an image". */
  reason: string
}

export interface WatcherOptions {
  /** The folder to watch, normally ~/Downloads. */
  dir: string
  onFile: (file: SettledFile) => void | Promise<void>
  /** Files Aegis put there itself (delivered or restored), so they aren't scanned twice. */
  delivered?: DeliveredLedger
  /**
   * At start, also report items added after this time (ms since epoch), e.g. while Aegis was
   * closed. Items created before it (or before the watcher started) are never reported, even when
   * they change: editing an old file in ~/Downloads isn't a new download.
   */
  since?: number
  /** How long an item must stay the same size before it counts as finished. */
  settleMs?: number
  pollMs?: number
  onError?: (err: unknown) => void
}

export interface Watcher {
  /** Resolves once the start-up scan has queued what it found. */
  ready: Promise<void>
  stop(): void
}

/** Chrome, Safari, Firefox and Opera write these while a download is in progress. */
const PARTIAL = ['.crdownload', '.download', '.part', '.opdownload']
/** Folders that are really one item and are scanned whole. */
const BUNDLES = ['app', 'workflow', 'mpkg', 'pkg', 'scptd']
/** An item still empty or still changing after this long is dropped from tracking. */
const MAX_TRACK_MS = 60 * 60 * 1000

export function startWatcher(opts: WatcherOptions): Watcher {
  const settleMs = opts.settleMs ?? 2000
  const pollMs = opts.pollMs ?? 500
  const onError = opts.onError ?? (() => {})
  // A little slack for a download that was being written as the watcher started.
  const createdFloor = opts.since ?? Date.now() - 2000
  const tracking = new Map<
    string,
    { size: number; mtimeMs: number; since: number; first: number }
  >()
  /** Items already reported, by inode + creation time, so a touched file isn't reported twice. */
  const reported = new Set<string>()
  let stopped = false
  let ticking = false

  const track = (name: string): void => {
    if (stopped || isIgnoredName(name)) return
    const path = join(opts.dir, name)
    if (!tracking.has(path)) {
      tracking.set(path, { size: -1, mtimeMs: -1, since: Date.now(), first: Date.now() })
    }
  }

  let fsWatcher: FSWatcher | null = null
  try {
    fsWatcher = watch(opts.dir, { persistent: false }, (_event, name) => {
      if (name) track(name.toString())
    })
    fsWatcher.on('error', onError)
  } catch (err) {
    onError(err)
  }

  const ready = (async () => {
    if (opts.since === undefined) return
    try {
      for (const name of await readdir(opts.dir)) {
        if (isIgnoredName(name)) continue
        const info = await lstat(join(opts.dir, name)).catch(() => null)
        if (info && createdAt(info) > opts.since) track(name)
      }
    } catch (err) {
      onError(err)
    }
  })()

  const tick = async (): Promise<void> => {
    if (ticking || stopped) return
    ticking = true
    try {
      for (const [path, t] of [...tracking]) {
        const now = Date.now()
        const info = await lstat(path).catch(() => null)
        if (!info || info.isSymbolicLink() || now - t.first > MAX_TRACK_MS) {
          tracking.delete(path)
          continue
        }
        const kind = itemKind(path, info.isDirectory(), info.isFile())
        if (!kind) {
          tracking.delete(path)
          continue
        }
        if (createdAt(info) < createdFloor) {
          tracking.delete(path)
          continue
        }
        const key = `${info.ino}:${createdAt(info)}`
        if (reported.has(key)) {
          tracking.delete(path)
          continue
        }
        const { size, mtimeMs } = kind === 'bundle' ? await bundleStat(path) : info
        if (size !== t.size || mtimeMs !== t.mtimeMs) {
          tracking.set(path, { ...t, size, mtimeMs, since: now })
          continue
        }
        if (size === 0 || now - t.since < settleMs) continue

        tracking.delete(path)
        reported.add(key)
        if (kind === 'file' && (await opts.delivered?.matches(path))) continue
        const head = kind === 'file' ? await readHead(path) : Buffer.alloc(0)
        const name = basename(path)
        await opts.onFile({ path, name, kind, size, ...classify(name, kind, head) })
      }
    } catch (err) {
      onError(err)
    } finally {
      ticking = false
    }
  }
  const timer = setInterval(() => void tick(), pollMs)

  return {
    ready,
    stop() {
      stopped = true
      clearInterval(timer)
      fsWatcher?.close()
      tracking.clear()
    }
  }
}

/** Hidden files (including Chrome's `.aegis-quarantine`), partial downloads and our own `.aegis` files. */
export function isIgnoredName(name: string): boolean {
  if (!name || name.includes('/') || name.startsWith('.')) return true
  if (name === CHROME_QUARANTINE_DIR) return true
  const lower = name.toLowerCase()
  return lower.endsWith(QUARANTINE_EXTENSION) || PARTIAL.some((s) => lower.endsWith(s))
}

/** Should this finished item be scanned? `head` is its first bytes (empty for a bundle). */
export function classify(
  name: string,
  kind: 'file' | 'bundle',
  head: Buffer
): { needsScan: boolean; reason: string } {
  const ext = extname(name).slice(1).toLowerCase()
  if (kind === 'bundle') return { needsScan: true, reason: `.${ext} bundle` }
  for (const [family, exts] of Object.entries(PASS_THROUGH_EXTENSIONS) as Array<
    [keyof typeof PASS_THROUGH_EXTENSIONS, readonly string[]]
  >) {
    if (!exts.includes(ext)) continue
    const noun = MEDIA_NOUN[family]
    return mediaMatches(ext, head)
      ? { needsScan: false, reason: `${noun}, type confirmed` }
      : {
          needsScan: true,
          reason: `.${ext} file that isn't a${/^[aeiou]/.test(noun) ? 'n' : ''} ${noun}`
        }
  }
  for (const [group, exts] of Object.entries(ALWAYS_SCAN_EXTENSIONS) as Array<
    [keyof typeof ALWAYS_SCAN_EXTENSIONS, readonly string[]]
  >) {
    if (exts.includes(ext)) return { needsScan: true, reason: SCAN_REASON[group] }
  }
  return { needsScan: true, reason: ext ? `unlisted type (.${ext})` : 'no extension' }
}

const MEDIA_NOUN = { images: 'image', audio: 'audio file', video: 'video' } as const
const SCAN_REASON = {
  executables: 'executable or installer',
  scripts: 'script',
  archives: 'archive',
  documents: 'document that can carry code',
  web: 'web file'
} as const

const ascii = (head: Buffer, at: number, text: string): boolean =>
  head.length >= at + text.length && head.toString('latin1', at, at + text.length) === text
const bytes = (head: Buffer, at: number, ...b: number[]): boolean =>
  head.length >= at + b.length && b.every((v, i) => head[at + i] === v)
const riff = (head: Buffer, form: string): boolean => ascii(head, 0, 'RIFF') && ascii(head, 8, form)
const ftyp = (head: Buffer): boolean => ascii(head, 4, 'ftyp')
const mp3Frame = (head: Buffer): boolean =>
  head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0

/** Does the file start the way a real file of this media type does? */
export function mediaMatches(ext: string, head: Buffer): boolean {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return bytes(head, 0, 0xff, 0xd8, 0xff)
    case 'png':
      return bytes(head, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'gif':
      return ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')
    case 'webp':
      return riff(head, 'WEBP')
    case 'bmp':
      return ascii(head, 0, 'BM')
    case 'tiff':
      return bytes(head, 0, 0x49, 0x49, 0x2a, 0x00) || bytes(head, 0, 0x4d, 0x4d, 0x00, 0x2a)
    case 'heic':
      return (
        ftyp(head) &&
        ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].some((b) => ascii(head, 8, b))
      )
    case 'mp3':
      return ascii(head, 0, 'ID3') || mp3Frame(head)
    case 'aac':
      return (
        ascii(head, 0, 'ID3') || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0)
      )
    case 'wav':
      return riff(head, 'WAVE')
    case 'avi':
      return riff(head, 'AVI ')
    case 'flac':
      return ascii(head, 0, 'fLaC')
    case 'ogg':
      return ascii(head, 0, 'OggS')
    case 'm4a':
    case 'mp4':
    case 'm4v':
      return ftyp(head)
    case 'mov':
      return (
        ftyp(head) ||
        ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].some((a) => ascii(head, 4, a))
      )
    case 'webm':
    case 'mkv':
      return bytes(head, 0, 0x1a, 0x45, 0xdf, 0xa3)
    default:
      return false
  }
}

/** Remembers what Aegis put in ~/Downloads (path + SHA-256), so the watcher skips it. */
export interface DeliveredLedger {
  record(path: string, sha256: string): void
  /** True if `path` is a file Aegis put there and its bytes haven't changed since. */
  matches(path: string): Promise<boolean>
  forget(path: string): void
}

export function createDeliveredLedger(): DeliveredLedger {
  const byPath = new Map<string, string>()
  return {
    record: (path, sha256) => void byPath.set(path, sha256),
    forget: (path) => void byPath.delete(path),
    async matches(path) {
      const want = byPath.get(path)
      if (!want) return false
      try {
        return (await sha256File(path)) === want
      } catch {
        return false
      }
    }
  }
}

function itemKind(path: string, isDir: boolean, isFile: boolean): 'file' | 'bundle' | null {
  if (isFile) return 'file'
  if (isDir && BUNDLES.includes(extname(path).slice(1).toLowerCase())) return 'bundle'
  return null
}

function createdAt(info: { birthtimeMs: number; ctimeMs: number }): number {
  return info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs
}

async function readHead(path: string, length = 64): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Total size and newest change time of everything inside a bundle (no symlinks followed). */
async function bundleStat(path: string): Promise<{ size: number; mtimeMs: number }> {
  let size = 0
  let mtimeMs = 0
  const visit = async (p: string): Promise<void> => {
    const info = await lstat(p)
    mtimeMs = Math.max(mtimeMs, info.mtimeMs)
    if (info.isDirectory()) for (const c of await readdir(p)) await visit(join(p, c))
    else if (info.isFile()) size += info.size
  }
  await visit(path)
  return { size, mtimeMs }
}
