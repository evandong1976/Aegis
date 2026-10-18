import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DownloadMeta } from '@shared/bridge'
import type { ScanReport } from '@shared/types'
import type { CreateParams, SandboxClient, SandboxLike } from './daytona'
import { createQuarantine } from './quarantine'
import { safeName, ScanService, type ScanServiceDeps } from './scans'
import { createDeliveredLedger } from './watcher'

const SCRIPT = Buffer.from('#!/bin/sh\necho AEGIS_DEMO_EXECUTED\n')
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >>\n')
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** A Daytona stand-in: keeps uploads in memory and answers the commands scans.ts runs. */
interface FakeBox {
  params: CreateParams
  files: Map<string, Buffer>
  deleted: boolean
}

function fakeDaytona(opts: { networkOn?: boolean; corrupt?: boolean } = {}): {
  client: SandboxClient
  made: FakeBox[]
} {
  const made: FakeBox[] = []
  const client: SandboxClient = {
    async create(params) {
      const box = { params, files: new Map<string, Buffer>(), deleted: false }
      made.push(box)
      const sandbox: SandboxLike = {
        id: `sbx-${made.length}`,
        networkBlockAll: opts.networkOn ? false : params.networkBlockAll,
        fs: {
          createFolder: async () => {},
          uploadFile: async (file, path) => {
            box.files.set(path, opts.corrupt && path === 'sample/file' ? Buffer.from('x') : file)
          }
        },
        process: {
          executeCommand: async (command) => {
            if (command.startsWith('sha256sum')) {
              return { exitCode: 0, result: `${sha(box.files.get('sample/file')!)}  sample/file\n` }
            }
            return { exitCode: 0, result: 'POSIX shell script, ASCII text executable\n' }
          }
        },
        delete: async () => {
          box.deleted = true
        }
      }
      return sandbox
    }
  }
  return { client, made }
}

describe('safe file names', () => {
  it('keeps names inside ~/Downloads', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd')
    expect(safeName('C:\\evil\\run.bat')).toBe('run.bat')
    expect(safeName('.zshrc')).toBe('zshrc')
    expect(safeName('a\u0000b:c.sh')).toBe('a_b_c.sh')
    expect(safeName('')).toBe('download')
  })
})

describe('the download pipeline', () => {
  let root: string
  let downloads: string
  let saved: Map<string, ScanReport>
  let logs: string[]
  let mode: 'block' | 'warn'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aegis-scans-'))
    downloads = join(root, 'Downloads')
    await mkdir(downloads)
    saved = new Map()
    logs = []
    mode = 'block'
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  function service(over: Partial<ScanServiceDeps> = {}): ScanService {
    return new ScanService({
      putScan: (r) => void saved.set(r.id, structuredClone(r)),
      quarantine: createQuarantine(join(root, 'quarantine')),
      downloadsDir: downloads,
      ledger: createDeliveredLedger(),
      sandboxClient: async () => fakeDaytona().client,
      mode: () => mode,
      takeSandboxJob: () => true,
      concurrency: 3,
      log: (_l, t) => void logs.push(t),
      onActive: () => {},
      markDownloaded: async () => {},
      ...over
    })
  }

  const meta = (filename: string): DownloadMeta => ({
    chromeDownloadId: 1,
    url: `https://example.com/${filename}`,
    filename
  })

  async function finished(svc: ScanService, id: string): Promise<ScanReport> {
    for (let i = 0; i < 200; i++) {
      const s = svc.status(id)
      if (s && (s.status === 'done' || s.status === 'failed')) return saved.get(id)!
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('scan never finished')
  }

  it('uploads a script into a network-off sandbox, deletes it, and holds the file', async () => {
    const daytona = fakeDaytona()
    const svc = service({ sandboxClient: async () => daytona.client })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))

    expect(daytona.made).toHaveLength(1)
    const box = daytona.made[0]
    expect(box.params.networkBlockAll).toBe(true)
    expect(box.files.get('sample/file')).toEqual(SCRIPT)
    expect(JSON.parse(box.files.get('sample/meta.json')!.toString())).toMatchObject({
      filename: 'update.sh',
      sha256: sha(SCRIPT),
      url: 'https://example.com/update.sh'
    })
    expect(box.deleted).toBe(true)

    // No analyst yet: never Clean, held out of ~/Downloads.
    expect(report).toMatchObject({ verdict: 'unknown', action: 'held', status: 'done' })
    expect(report.checks.map((c) => c.name)).toEqual([
      'Local pre-check',
      'Daytona sandbox',
      'Upload check (SHA-256)',
      'Analysis (Worker A)'
    ])
    expect(report.sandbox[0]).toMatchObject({
      provider: 'daytona',
      network: 'off',
      sandboxId: 'sbx-1'
    })
    expect(report.sandbox[0].destroyedAt).not.toBeNull()
    expect(await readdir(downloads)).toEqual([])
    const held = await stat(report.heldPath!)
    expect(report.heldPath).toMatch(/update\.sh\.aegis$/)
    expect(held.mode & 0o777).toBe(0o600)
    expect(await readFile(report.heldPath!)).toEqual(SCRIPT)
  })

  it('lets the analyst raise the verdict, never lower it', async () => {
    const svc = service({
      analyze: async () => ({
        verdict: 'malicious',
        summary: 'Downloads and runs a second file.',
        reasons: [{ code: 'droid', text: 'downloads and runs code', weight: 0, hard: false }]
      })
    })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(report).toMatchObject({ verdict: 'malicious', action: 'quarantined' })
    expect(report.summary).toBe('Downloads and runs a second file.')
  })

  it("puts Droid's review in the report and counts the sandbox checks' reasons", async () => {
    const svc = service({
      analyze: async () => ({
        verdict: 'unknown',
        summary: "Aegis's checks found: downloads a script and runs it.",
        reasons: [
          {
            code: 'sh_download_exec',
            text: 'downloads a script and runs it',
            weight: 40,
            hard: true
          }
        ],
        droid: {
          timeline: [],
          verdict: 'unknown',
          summary: 's',
          confidence: 'low',
          unknowns: ['Droid timed out'],
          reviewer: 'rules'
        },
        findings: [
          { severity: 'critical', title: 'Downloads a script and runs it', detail: 'Malware sign.' }
        ],
        capabilities: ['Download and run'],
        code: [
          {
            path: 'update.sh',
            origin: 'read inside the sandbox',
            startLine: 1,
            lines: ['curl x | sh'],
            flags: []
          }
        ]
      })
    })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(report).toMatchObject({ verdict: 'malicious', action: 'quarantined' })
    expect(report.reasons.map((r) => r.code)).toContain('sh_download_exec')
    expect(report.droid?.reviewer).toBe('rules')
    expect(report.stage1?.findings[0].title).toBe('Downloads a script and runs it')
    expect(report.code[0].lines).toEqual(['curl x | sh'])
    expect(report.checks.find((c) => c.name === 'Analysis')).toMatchObject({
      state: 'warn',
      result: "Aegis's checks only"
    })
  })

  it('delivers a plain document without uploading it, as the exact bytes', async () => {
    const daytona = fakeDaytona()
    const ledger = createDeliveredLedger()
    const svc = service({ sandboxClient: async () => daytona.client, ledger })
    const report = await finished(svc, svc.fromChrome(PDF, meta('statement.pdf')))
    expect(daytona.made).toHaveLength(0)
    expect(report).toMatchObject({ verdict: 'clean', action: 'delivered' })
    const path = join(downloads, 'statement.pdf')
    expect(await readFile(path)).toEqual(PDF)
    expect(await ledger.matches(path)).toBe(true)
  })

  it('never writes over a file already in ~/Downloads', async () => {
    await writeFile(join(downloads, 'statement.pdf'), 'mine')
    const svc = service()
    await finished(svc, svc.fromChrome(PDF, meta('statement.pdf')))
    expect((await readdir(downloads)).sort()).toEqual(['statement (1).pdf', 'statement.pdf'])
    expect(await readFile(join(downloads, 'statement.pdf'), 'utf8')).toBe('mine')
  })

  it('holds the file when Daytona is not set up, and says why', async () => {
    const svc = service({ sandboxClient: async () => null })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(report).toMatchObject({ verdict: 'unknown', action: 'held', partial: true })
    expect(report.summary).toMatch(/can't scan this right now/)
  })

  it('refuses a sandbox that came back with the network on', async () => {
    const daytona = fakeDaytona({ networkOn: true })
    const svc = service({ sandboxClient: async () => daytona.client })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(daytona.made[0].files.size).toBe(0)
    expect(daytona.made[0].deleted).toBe(true)
    expect(report).toMatchObject({ verdict: 'unknown', action: 'held' })
    expect(report.checks.find((c) => c.name === 'Daytona sandbox')?.state).toBe('fail')
  })

  it('treats a corrupted upload as a failed sandbox step', async () => {
    const daytona = fakeDaytona({ corrupt: true })
    const svc = service({ sandboxClient: async () => daytona.client })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(report.checks.find((c) => c.name === 'Daytona sandbox')?.result).toMatch(
      /upload check failed/
    )
    expect(daytona.made[0].deleted).toBe(true)
  })

  it('stops at the daily budget', async () => {
    const daytona = fakeDaytona()
    const svc = service({ sandboxClient: async () => daytona.client, takeSandboxJob: () => false })
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(daytona.made).toHaveLength(0)
    expect(report.checks.find((c) => c.name === 'Daytona sandbox')?.result).toBe(
      'daily budget used'
    )
  })

  it('delivers in warn mode', async () => {
    mode = 'warn'
    const svc = service()
    const report = await finished(svc, svc.fromChrome(SCRIPT, meta('update.sh')))
    expect(report).toMatchObject({ verdict: 'unknown', action: 'delivered' })
    expect(await readdir(downloads)).toEqual(['update.sh'])
  })

  it('quarantines a file from ~/Downloads at once, and puts a clean one back', async () => {
    const path = join(downloads, 'statement.pdf')
    await writeFile(path, PDF)
    const svc = service()
    const id = await svc.fromPath({ path, source: 'watcher' })
    expect(id).not.toBeNull()
    const report = await finished(svc, id!)
    expect(report).toMatchObject({ kind: 'quarantine', seenIn: '~/Downloads', action: 'delivered' })
    expect(await readFile(path)).toEqual(PDF)
  })

  it('keeps a risky file from ~/Downloads in quarantine', async () => {
    const path = join(downloads, 'run.command')
    await writeFile(path, SCRIPT, { mode: 0o755 })
    const svc = service()
    const report = await finished(svc, (await svc.fromPath({ path, source: 'watcher' }))!)
    expect(report.action).toBe('held')
    expect(await readdir(downloads)).toEqual([])
    expect((await stat(report.heldPath!)).mode & 0o777).toBe(0o600)
  })

  it("takes Chrome's quarantine copy, and restores it to ~/Downloads by its real name", async () => {
    await mkdir(join(downloads, '.aegis-quarantine'))
    const path = join(downloads, '.aegis-quarantine', 'statement.pdf.aegis')
    await writeFile(path, PDF)
    const svc = service()
    const report = await finished(svc, (await svc.fromPath({ path, source: 'chrome' }))!)
    expect(report).toMatchObject({
      filename: 'statement.pdf',
      kind: 'download',
      action: 'delivered'
    })
    expect(await readFile(join(downloads, 'statement.pdf'))).toEqual(PDF)
  })

  it('keeps the name the user expects when Chrome renamed its copy', async () => {
    const path = join(downloads, 'invoice.pdf.html')
    await writeFile(path, '<!doctype html><title>Sign in</title>')
    const svc = service()
    const id = await svc.fromPath({ path, source: 'chrome', filename: 'invoice.pdf' })
    const report = await finished(svc, id!)
    expect(report).toMatchObject({ filename: 'invoice.pdf', action: 'held' })
    expect(await readdir(downloads)).toEqual([])
  })

  it('refuses paths outside the downloads folder, and takes a file only once', async () => {
    const outside = join(root, 'secret.txt')
    await writeFile(outside, 'x')
    const svc = service()
    expect(await svc.fromPath({ path: outside, source: 'chrome' })).toBeNull()
    expect(
      await svc.fromPath({ path: join(downloads, '..', 'secret.txt'), source: 'chrome' })
    ).toBeNull()
    expect(await readFile(outside, 'utf8')).toBe('x')

    const path = join(downloads, 'run.command')
    await writeFile(path, SCRIPT)
    const [a, b] = await Promise.all([
      svc.fromPath({ path, source: 'watcher' }),
      svc.fromPath({ path, source: 'chrome' })
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('runs at most `concurrency` sandboxes at once', async () => {
    let live = 0
    let peak = 0
    const base = fakeDaytona().client
    const client: SandboxClient = {
      async create(params, o) {
        live++
        peak = Math.max(peak, live)
        await new Promise((r) => setTimeout(r, 20))
        const s = await base.create(params, o)
        const del = s.delete.bind(s)
        s.delete = async (t) => {
          live--
          await del(t)
        }
        return s
      }
    }
    const svc = service({ sandboxClient: async () => client, concurrency: 2 })
    const ids = [1, 2, 3, 4, 5].map((n) => svc.fromChrome(SCRIPT, meta(`s${n}.sh`)))
    for (const id of ids) await finished(svc, id)
    expect(peak).toBe(2)
  })
})
