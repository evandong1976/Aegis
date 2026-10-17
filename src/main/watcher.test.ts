import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  classify,
  createDeliveredLedger,
  isIgnoredName,
  mediaMatches,
  startWatcher,
  type SettledFile,
  type Watcher
} from './watcher'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01])
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')])

describe('which names are ignored', () => {
  it('skips partial downloads, hidden files and our own .aegis files', () => {
    for (const name of [
      'big.iso.crdownload',
      'page.zip.download',
      'movie.mp4.part',
      '.DS_Store',
      '.aegis-quarantine',
      'invoice.pdf.aegis'
    ]) {
      expect(isIgnoredName(name), name).toBe(true)
    }
    expect(isIgnoredName('invoice.pdf')).toBe(false)
    expect(isIgnoredName('Installer.pkg')).toBe(false)
  })
})

describe('what gets scanned', () => {
  it('passes media through only when the bytes confirm the type', () => {
    expect(classify('photo.jpg', 'file', JPEG)).toEqual({
      needsScan: false,
      reason: 'image, type confirmed'
    })
    expect(classify('clip.mp4', 'file', MP4).needsScan).toBe(false)
    // A photo.jpg that is really a Mach-O binary is scanned (MEGA_PROMPT §5.1).
    expect(classify('photo.jpg', 'file', MACHO)).toEqual({
      needsScan: true,
      reason: ".jpg file that isn't an image"
    })
    expect(classify('photo.png', 'file', JPEG).needsScan).toBe(true)
    expect(classify('song.mp3', 'file', Buffer.alloc(0)).needsScan).toBe(true)
  })

  it('always scans the always-scan list, bundles and anything unlisted', () => {
    expect(classify('invoice.pdf', 'file', Buffer.from('%PDF-1.7'))).toEqual({
      needsScan: true,
      reason: 'document that can carry code'
    })
    expect(classify('run.command', 'file', Buffer.from('#!/bin/sh')).reason).toBe('script')
    expect(classify('Setup.pkg', 'file', Buffer.from('xar!')).reason).toBe(
      'executable or installer'
    )
    expect(classify('Thing.app', 'bundle', Buffer.alloc(0))).toEqual({
      needsScan: true,
      reason: '.app bundle'
    })
    expect(classify('notes.xyz', 'file', Buffer.from('hi')).reason).toBe('unlisted type (.xyz)')
    expect(classify('README', 'file', Buffer.from('hi')).reason).toBe('no extension')
  })

  it('knows the media signatures', () => {
    expect(mediaMatches('png', PNG)).toBe(true)
    expect(mediaMatches('gif', Buffer.from('GIF89a'))).toBe(true)
    expect(mediaMatches('webp', Buffer.from('RIFF\0\0\0\0WEBP'))).toBe(true)
    expect(mediaMatches('wav', Buffer.from('RIFF\0\0\0\0WAVE'))).toBe(true)
    expect(mediaMatches('webp', Buffer.from('RIFF\0\0\0\0WAVE'))).toBe(false)
    expect(mediaMatches('flac', Buffer.from('fLaC'))).toBe(true)
    expect(mediaMatches('mkv', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true)
    expect(mediaMatches('heic', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic')]))).toBe(
      true
    )
    expect(mediaMatches('heic', MP4)).toBe(false)
  })
})

describe('the watcher', () => {
  let dir: string
  let watcher: Watcher | null = null
  let seen: SettledFile[]

  const start = (extra: Partial<Parameters<typeof startWatcher>[0]> = {}): Watcher => {
    watcher = startWatcher({
      dir,
      settleMs: 150,
      pollMs: 25,
      onFile: (f) => void seen.push(f),
      ...extra
    })
    return watcher
  }
  const waitFor = async (check: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600))

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aegis-watcher-'))
    seen = []
  })
  afterEach(async () => {
    watcher?.stop()
    watcher = null
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a file once, after it stops growing', async () => {
    start()
    const path = join(dir, 'tool.sh')
    await writeFile(path, '#!/bin/sh\n')
    await new Promise((r) => setTimeout(r, 60))
    await appendFile(path, 'echo one\n')
    await new Promise((r) => setTimeout(r, 60))
    await appendFile(path, 'echo two\n')

    await waitFor(() => seen.length === 1)
    await settle()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      path,
      name: 'tool.sh',
      kind: 'file',
      size: '#!/bin/sh\necho one\necho two\n'.length,
      needsScan: true,
      reason: 'script'
    })
  })

  it('waits for a partial download to get its real name', async () => {
    start()
    await writeFile(join(dir, 'disk.iso.crdownload'), 'data')
    await settle()
    expect(seen).toHaveLength(0)
    await rename(join(dir, 'disk.iso.crdownload'), join(dir, 'disk.iso'))
    await waitFor(() => seen.length === 1)
    expect(seen[0].name).toBe('disk.iso')
  })

  it('reports media too, marked as not needing a scan', async () => {
    start()
    await writeFile(join(dir, 'real.jpg'), JPEG)
    await writeFile(join(dir, 'fake.jpg'), MACHO)
    await waitFor(() => seen.length === 2)
    const byName = Object.fromEntries(seen.map((f) => [f.name, f.needsScan]))
    expect(byName).toEqual({ 'real.jpg': false, 'fake.jpg': true })
  })

  it('reports a bundle as one item', async () => {
    start()
    const app = join(dir, 'Thing.app')
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(join(app, 'Contents', 'MacOS', 'Thing'), 'binary')
    await waitFor(() => seen.length === 1)
    await settle()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ name: 'Thing.app', kind: 'bundle', size: 6, needsScan: true })
  })

  it('ignores ordinary folders, hidden files and empty files', async () => {
    start()
    await mkdir(join(dir, 'Photos from trip'))
    await writeFile(join(dir, 'Photos from trip', 'a.exe'), 'MZ')
    await writeFile(join(dir, '.hidden.sh'), 'x')
    await writeFile(join(dir, 'empty.pdf'), '')
    await settle()
    expect(seen).toHaveLength(0)
  })

  it("skips files Aegis delivered, unless they've changed", async () => {
    const delivered = createDeliveredLedger()
    const ok = join(dir, 'clean.pdf')
    const changed = join(dir, 'changed.pdf')
    const body = '%PDF-1.7 clean'
    delivered.record(ok, createHash('sha256').update(body).digest('hex'))
    delivered.record(changed, createHash('sha256').update(body).digest('hex'))
    start({ delivered })
    await writeFile(ok, body)
    await writeFile(changed, '%PDF-1.7 different bytes')
    await waitFor(() => seen.length === 1)
    await settle()
    expect(seen.map((f) => f.name)).toEqual(['changed.pdf'])
  })

  it("doesn't report an old file that changes", async () => {
    const path = join(dir, 'old-notes.sh')
    await writeFile(path, '#!/bin/sh\n')
    await new Promise((r) => setTimeout(r, 2100))
    start()
    await appendFile(path, 'echo edited\n')
    await new Promise((r) => setTimeout(r, 300))
    expect(seen).toEqual([])
  })

  it('at start, picks up only what arrived since the given time', async () => {
    await writeFile(join(dir, 'old.zip'), 'PK')
    await new Promise((r) => setTimeout(r, 50))
    const since = Date.now()
    await new Promise((r) => setTimeout(r, 50))
    await writeFile(join(dir, 'new.zip'), 'PK')

    await start({ since }).ready
    await waitFor(() => seen.length === 1)
    await settle()
    expect(seen.map((f) => f.name)).toEqual(['new.zip'])
  })
})
