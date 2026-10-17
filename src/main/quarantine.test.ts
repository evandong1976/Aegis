import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createQuarantine, freePath, withQuarantineExtension, type Quarantine } from './quarantine'

let base: string
let downloads: string
let q: Quarantine
const mode = async (p: string): Promise<number> => (await stat(p)).mode & 0o777

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'aegis-quarantine-'))
  downloads = join(base, 'Downloads')
  await mkdir(downloads)
  q = createQuarantine(join(base, 'quarantine'))
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('quarantine', () => {
  it('moves a file in with .aegis, mode 600, its hash and where it came from', async () => {
    const src = join(downloads, 'setup.sh')
    const body = 'echo hello\n'
    await writeFile(src, body, { mode: 0o755 })

    const entry = await q.add(src, 'scan-1')

    expect(existsSync(src)).toBe(false)
    expect(entry.path).toBe(join(base, 'quarantine', 'scan-1', 'setup.sh.aegis'))
    expect(await readFile(entry.path, 'utf8')).toBe(body)
    expect(await mode(entry.path)).toBe(0o600)
    expect(entry).toMatchObject({
      id: 'scan-1',
      name: 'setup.sh',
      originalPath: src,
      kind: 'file',
      size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      modes: { '': 0o755 }
    })
    expect(await q.get('scan-1')).toEqual(entry)
    expect(await q.list()).toEqual([entry])
  })

  it('restores to the original path with the original permissions', async () => {
    const src = join(downloads, 'tool')
    await writeFile(src, 'bytes', { mode: 0o755 })
    await q.add(src, 'scan-2')

    expect(await q.restore('scan-2')).toBe(src)
    expect(await readFile(src, 'utf8')).toBe('bytes')
    expect(await mode(src)).toBe(0o755)
    expect(await q.get('scan-2')).toBeNull()
    expect(existsSync(join(base, 'quarantine', 'scan-2'))).toBe(false)
  })

  it('never restores over another file', async () => {
    const src = join(downloads, 'report.pdf')
    await writeFile(src, 'first')
    await q.add(src, 'scan-3')
    await writeFile(src, 'a newer file with the same name')

    expect(await q.restore('scan-3')).toBe(join(downloads, 'report (1).pdf'))
    expect(await readFile(src, 'utf8')).toBe('a newer file with the same name')
  })

  it('deletes for good', async () => {
    const src = join(downloads, 'x.exe')
    await writeFile(src, 'MZ')
    await q.add(src, 'scan-4')
    await q.remove('scan-4')
    expect(await q.get('scan-4')).toBeNull()
    expect(await q.list()).toEqual([])
  })

  it('locks down a bundle and restores its permissions', async () => {
    const app = join(downloads, 'Thing.app')
    const bin = join(app, 'Contents', 'MacOS', 'Thing')
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(bin, 'binary', { mode: 0o755 })

    const entry = await q.add(app, 'scan-5')
    expect(entry.kind).toBe('bundle')
    expect(entry.sha256).toBeNull()
    expect(entry.size).toBe('binary'.length)
    const inside = join(entry.path, 'Contents', 'MacOS', 'Thing')
    expect(await mode(entry.path)).toBe(0o700)
    expect(await mode(inside)).toBe(0o600)

    await q.restore('scan-5')
    expect(await mode(bin)).toBe(0o755)
  })

  it("doesn't follow a bundle's symlinks when changing permissions", async () => {
    const outside = join(base, 'outside.txt')
    await writeFile(outside, 'not ours', { mode: 0o644 })
    const app = join(downloads, 'Linked.app')
    await mkdir(app)
    await symlink(outside, join(app, 'link'))

    await q.add(app, 'scan-6')
    expect(await mode(outside)).toBe(0o644)
  })

  it('refuses symlinks and bad ids', async () => {
    const target = join(downloads, 'real.txt')
    await writeFile(target, 'x')
    await symlink(target, join(downloads, 'link.txt'))
    await expect(q.add(join(downloads, 'link.txt'), 'scan-7')).rejects.toThrow(/symlink/)
    await expect(q.add(target, '../escape')).rejects.toThrow(/Invalid quarantine id/)
    expect(existsSync(target)).toBe(true)
  })

  it('keeps a given original path and never doubles .aegis', async () => {
    const chrome = join(downloads, '.aegis-quarantine')
    await mkdir(chrome)
    const src = join(chrome, 'invoice.iso.aegis')
    await writeFile(src, 'iso')
    const entry = await q.add(src, 'scan-8', { originalPath: join(downloads, 'invoice.iso') })
    expect(entry.path.endsWith('invoice.iso.aegis')).toBe(true)
    expect(entry.name).toBe('invoice.iso')
    expect(await q.restore('scan-8')).toBe(join(downloads, 'invoice.iso'))
  })

  it.runIf(process.platform === 'darwin')('keeps the macOS quarantine attribute', async () => {
    const src = join(downloads, 'from-safari.zip')
    await writeFile(src, 'PK')
    const value = '0083;00000000;Safari;'
    execFileSync('xattr', ['-w', 'com.apple.quarantine', value, src])
    const entry = await q.add(src, 'scan-9')
    const read = (p: string): string =>
      execFileSync('xattr', ['-p', 'com.apple.quarantine', p], { encoding: 'utf8' }).trim()
    expect(read(entry.path)).toBe(value)
    expect(read(await q.restore('scan-9'))).toBe(value)
  })
})

describe('names', () => {
  it('adds .aegis once', () => {
    expect(withQuarantineExtension('a.pdf')).toBe('a.pdf.aegis')
    expect(withQuarantineExtension('a.pdf.aegis')).toBe('a.pdf.aegis')
  })

  it('finds a free name beside a taken one', async () => {
    const p = join(downloads, 'a.txt')
    expect(await freePath(p)).toBe(p)
    await writeFile(p, '')
    await writeFile(join(downloads, 'a (1).txt'), '')
    expect(await freePath(p)).toBe(join(downloads, 'a (2).txt'))
  })
})
