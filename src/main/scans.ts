// The download pipeline (milestone 3; MEGA_PROMPT §5.1 and §5.3, architectural.md §4.4).
//
// Two ways in:
// - `fromChrome`: bytes the extension fetched in memory. They were never written to ~/Downloads.
// - `fromPath`: a file already on disk (the ~/Downloads watcher, or Chrome's quarantine fallback).
//   It is moved into Aegis's quarantine first, so it can't be opened while it's scanned.
//
// Then: pre-check on this Mac (bytes only) → if it needs the cloud, upload into a fresh Daytona
// sandbox created with the network off, check the SHA-256 inside it, hand it to `analyze` (Worker
// A: it opens the file there and Droid reviews it), and delete the sandbox in a `finally` →
// verdict → act: deliver the exact bytes that were scanned, or hold / quarantine them. Every path
// ends delivered, held or quarantined; a download is never lost.
//
// With `live` set (the app), a file that goes to the sandbox is drawn in the live view as it
// happens, like the "Test the sandbox" samples (decision 30): the main window opens on it.
//
// Until an analyst exists, nothing that went to the sandbox can be called Clean (verdict.ts:
// missing evidence means Unknown), so in block mode those files are held for the user.

import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, realpath, writeFile } from 'fs/promises'
import { basename, join, relative, sep } from 'path'
import { promisify } from 'util'
import { QUARANTINE_EXTENSION } from '@shared/constants'
import type { DownloadMeta, ScanStatusResponse } from '@shared/bridge'
import type { LiveEventBody, LiveStage } from '@shared/live'
import type {
  CodeExcerpt,
  DroidReport,
  Finding,
  Reason,
  SandboxRecord,
  ScanAction,
  ScanReport,
  ScanSource,
  Verdict
} from '@shared/types'
import {
  SAMPLE_PATH,
  withSandbox,
  type SampleMeta,
  type SandboxClient,
  type SandboxLogEntry,
  type SandboxSession
} from './daytona'
import { precheck, type Precheck } from './precheck'
import {
  announceSandbox,
  announceUpload,
  liveEmitters,
  runsAsShell,
  type Emitters
} from './sandboxScan'
import { freePath, type Quarantine } from './quarantine'
import { applyAiSuggestion, combine } from './verdict'
import type { DeliveredLedger } from './watcher'
import { workerBReport, type WorkerBResult } from './workerB'

/** Whole sandbox job, start included (architectural.md §4.6). */
export const WORKER_TIMEOUT_MS = 120_000

/** What an analyst (Worker A, droidAgent.ts) returns while the sample is in the sandbox. */
export interface SandboxAnalysis {
  /** The analyst's (AI's) verdict: it can only raise the rules' verdict. */
  verdict: Verdict
  summary: string
  /** Rule reasons from the sandbox checks; they count toward the score like the pre-check's. */
  reasons: Reason[]
  /** Droid's review, for the Report's timeline. */
  droid?: DroidReport
  findings?: Finding[]
  capabilities?: string[]
  code?: CodeExcerpt[]
}

/** What `analyze` gets besides the sandbox and the sample. */
export interface AnalyzeContext {
  /** This scan's live events (they go nowhere without the live view). */
  live: Emitters
  /** Run it under `sh -x` (a shell script); otherwise it is only read. */
  run: boolean
  /** What it is, for people: "Script", "PDF". */
  kind: string
}

/** The live view's side of a download (index.ts: the LiveBus and the main window). */
export interface ScanLive {
  /** A file is going to the sandbox: start its run on the bus and show it. */
  begin(run: { scanId: string; filename: string; size: number; sha256: string }): void
  emit(scanId: string, body: LiveEventBody): void
}

const NO_LIVE = (): Emitters => liveEmitters(() => undefined)

export interface ScanServiceDeps {
  putScan(report: ScanReport, extra: { fileCategory: string | null; caughtBy: string | null }): void
  quarantine: Quarantine
  /** ~/Downloads (or AEGIS_DOWNLOADS_DIR in tests and verification runs). */
  downloadsDir: string
  /** Files Aegis put in ~/Downloads, so the watcher doesn't scan them again. */
  ledger: DeliveredLedger
  /** A Daytona client, or null when DAYTONA_API_KEY isn't set. */
  sandboxClient(): Promise<SandboxClient | null>
  snapshot?: string
  mode(): 'block' | 'warn'
  /** Counts a sandbox job against the daily budget; false once it's used up. */
  takeSandboxJob(): boolean
  /** Jobs in sandboxes at once (MEGA_PROMPT §5.3: 3). */
  concurrency: number
  log(level: 'block' | 'warn' | 'allow' | null, text: string): void
  /** Scans in progress, for the tray and panel. */
  onActive(count: number): void
  /**
   * Runs while the sample is in the sandbox. Not set until Worker A (M4): the file is uploaded,
   * checked and the sandbox deleted, and the verdict stays Unknown.
   */
  analyze?: (
    session: SandboxSession,
    sample: SampleMeta,
    ctx: AnalyzeContext
  ) => Promise<SandboxAnalysis>
  /**
   * Worker B (Chalk): the same bytes, examined independently in a Chalk sandbox by Claude through
   * the Model Gateway (workerB.ts). Not set when Chalk isn't configured.
   */
  workerB?: (bytes: Buffer, meta: { filename: string; scanId: string }) => Promise<WorkerBResult>
  workerBTimeoutMs?: number
  /** Marks a delivered file as downloaded from the internet (Gatekeeper checks it). */
  markDownloaded?: (path: string, url: string | null) => Promise<void>
  workerTimeoutMs?: number
  /** The live view. Not set in tests. */
  live?: ScanLive
}

interface Intake {
  id: string
  name: string
  source: ScanSource
  kind: 'download' | 'quarantine'
  seenIn: string
  url: string | null
  referrer: string | null
  mime: string | null
  /** Set when the file is already in quarantine (fromPath). */
  quarantined: boolean
}

/** A name safe to write into ~/Downloads: no folders, no control characters, no leading dot. */
export function safeName(input: string): string {
  const base = basename(input.replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/:]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
  return (base || 'download').slice(0, 200)
}

/** "Gmail", "Outlook" or "Chrome", from the page the download came from. */
function seenInFor(referrer: string | null): string {
  if (!referrer) return 'Chrome'
  try {
    const host = new URL(referrer).hostname
    if (host === 'mail.google.com') return 'Gmail'
    if (/^outlook\.(live|office|office365)\.com$/.test(host)) return 'Outlook'
  } catch {
    // Not a URL.
  }
  return 'Chrome'
}

export async function markDownloadedOnMac(path: string): Promise<void> {
  if (process.platform !== 'darwin') return
  // The same attribute Chrome and Safari set, so Gatekeeper still checks a delivered file.
  const flags = `0081;${Math.floor(Date.now() / 1000).toString(16)};Aegis;`
  await promisify(execFile)('/usr/bin/xattr', ['-w', 'com.apple.quarantine', flags, path])
}

export class ScanService {
  private readonly deps: ScanServiceDeps
  private readonly reports = new Map<string, ScanReport>()
  /** Paths being taken into quarantine, so the watcher and the extension don't both take one. */
  private readonly claimed = new Set<string>()
  /** Which engine raised a scan to Malicious, for the Downloads screen's "What caught them". */
  private readonly caughtBy = new Map<string, string>()
  private active = 0
  private running = 0
  private readonly waiting: Array<() => void> = []

  constructor(deps: ScanServiceDeps) {
    this.deps = deps
  }

  /** Bytes fetched in memory by the extension. Returns the scan ID at once; the scan runs on. */
  fromChrome(bytes: Buffer, meta: DownloadMeta): string {
    const intake: Intake = {
      id: randomUUID(),
      name: safeName(meta.filename),
      source: 'chrome',
      kind: 'download',
      seenIn: seenInFor(meta.referrer ?? null),
      url: meta.url,
      referrer: meta.referrer ?? null,
      mime: meta.mime ?? null,
      quarantined: false
    }
    void this.run(intake, bytes)
    return intake.id
  }

  /**
   * A file already on disk inside the downloads folder. It moves into quarantine before this
   * returns. Returns null if it isn't inside the downloads folder, or is already being handled.
   */
  async fromPath(input: {
    path: string
    source: ScanSource
    url?: string | null
    referrer?: string | null
    /** The name the user expects, when Chrome saved it under another (`x.pdf.html`, `x.aegis`). */
    filename?: string
  }): Promise<string | null> {
    const path = await this.insideDownloads(input.path)
    if (!path || this.claimed.has(path)) return null
    this.claimed.add(path)
    try {
      const id = randomUUID()
      const name = safeName(
        input.filename || basename(path).replace(new RegExp(`\\${QUARANTINE_EXTENSION}$`), '')
      )
      // Restored (if it's ever restored) to ~/Downloads under the name the user expects.
      const entry = await this.deps.quarantine.add(path, id, {
        originalPath: join(this.deps.downloadsDir, name)
      })
      const fromChrome = input.source === 'chrome'
      const intake: Intake = {
        id,
        name,
        source: input.source,
        kind: fromChrome ? 'download' : 'quarantine',
        seenIn: fromChrome ? seenInFor(input.referrer ?? null) : '~/Downloads',
        url: input.url ?? null,
        referrer: input.referrer ?? null,
        mime: null,
        quarantined: true
      }
      this.deps.log('warn', `download quarantined scan=${id} name=${name} from=${input.source}`)
      void readFile(entry.path).then(
        (bytes) => this.run(intake, bytes),
        (err) => this.run(intake, null, err)
      )
      return id
    } catch (err) {
      // Gone already (the other path got it first), or unreadable: leave it where it is.
      this.deps.log('warn', `download not quarantined path=${path} error=${explain(err)}`)
      return null
    } finally {
      this.claimed.delete(path)
    }
  }

  /** POST /scan/:id */
  status(id: string): ScanStatusResponse | null {
    const r = this.reports.get(id)
    if (!r) return null
    return {
      scanId: r.id,
      status: r.status,
      verdict: r.verdict,
      summary: r.summary,
      held: r.action === 'held' || r.action === 'quarantined'
    }
  }

  private async insideDownloads(path: string): Promise<string | null> {
    try {
      const [dir, real] = await Promise.all([realpath(this.deps.downloadsDir), realpath(path)])
      const rel = relative(dir, real)
      return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? real : null
    } catch {
      return null
    }
  }

  private save(r: ScanReport, pc: Precheck | null): void {
    r.updatedAt = new Date().toISOString()
    this.reports.set(r.id, r)
    this.deps.putScan(r, {
      fileCategory: pc?.category ?? null,
      caughtBy: r.verdict === 'malicious' ? (this.caughtBy.get(r.id) ?? 'Local pre-check') : null
    })
  }

  private async slot(): Promise<() => void> {
    if (this.running >= this.deps.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.running++
    return () => {
      this.running--
      this.waiting.shift()?.()
    }
  }

  private setActive(delta: number): void {
    this.active += delta
    this.deps.onActive(this.active)
  }

  private async run(intake: Intake, bytes: Buffer | null, readError?: unknown): Promise<void> {
    const started = Date.now()
    const now = new Date(started).toISOString()
    const r: ScanReport = {
      id: intake.id,
      kind: intake.kind,
      source: intake.source,
      seenIn: intake.seenIn,
      url: intake.url,
      filename: intake.name,
      fileKind: null,
      size: bytes?.length ?? null,
      status: 'received',
      verdict: null,
      score: null,
      reason: null,
      action: 'scanning',
      durationMs: null,
      createdAt: now,
      updatedAt: now,
      summary: null,
      reasons: [],
      stage1: null,
      droid: null,
      indicators: {
        sha256: null,
        realType: null,
        claimedType: null,
        signature: null,
        size: bytes?.length ?? null,
        firstSeen: now
      },
      code: [],
      checks: [],
      sandbox: [],
      partial: false,
      heldPath: null
    }
    let pc: Precheck | null = null
    let live: Emitters | null = null
    this.setActive(1)
    this.save(r, pc)
    this.deps.log(
      null,
      `download received scan=${r.id} name=${intake.name} size=${bytes?.length ?? '?'} from=${intake.source}${intake.quarantined ? '' : ' (in memory, not on disk)'}`
    )

    try {
      if (!bytes) throw readError ?? new Error('no bytes')
      pc = precheck(intake.name, bytes)
      Object.assign(r, { status: 'prechecked', fileKind: pc.fileKind, size: pc.size })
      r.indicators = {
        ...r.indicators,
        sha256: pc.sha256,
        realType: pc.realType,
        claimedType: pc.ext || null
      }
      const hard = pc.reasons.some((x) => x.hard)
      r.checks.push({
        name: 'Local pre-check',
        state: hard ? 'fail' : pc.documentRisks.length ? 'warn' : 'ok',
        result: hard
          ? (pc.reasons.find((x) => x.hard)?.text ?? 'hard rule')
          : pc.needsCloud
            ? 'needs the sandbox'
            : 'cleared on this Mac'
      })
      this.save(r, pc)
      this.deps.log(
        hard ? 'block' : null,
        `precheck scan=${r.id} type=${pc.realType} sha256=${pc.sha256.slice(0, 12)} cloud=${pc.needsCloud} why="${pc.why}"`
      )

      // Both workers at once, each on its own copy (decision 17): Worker A's Daytona path and
      // Worker B in Chalk.
      let analysis: SandboxAnalysis | null = null
      let b: ReturnType<typeof workerBReport> | null = null
      if (pc.needsCloud) {
        live = this.beginLive(r, pc)
        ;[analysis, b] = await Promise.all([
          this.sandbox(r, pc, bytes, intake, live),
          this.workerB(r, pc, bytes, intake, live)
        ])
      }

      const a = analysis
      const analysed = a !== null || (b?.analysed ?? false)
      let verdict = combine([...pc.reasons, ...(a?.reasons ?? []), ...(b?.reasons ?? [])], {
        confident: !pc.needsCloud || analysed
      })
      if (a) verdict = applyAiSuggestion(verdict, a.verdict)
      if (b?.verdict) {
        const before = verdict.verdict
        verdict = applyAiSuggestion(verdict, b.verdict)
        if (verdict.verdict !== before && verdict.verdict === 'malicious') {
          this.caughtBy.set(r.id, 'Worker B (Chalk)')
        }
      }
      const top = [...verdict.reasons].sort((x, y) => y.weight - x.weight)[0]
      const workerSummary = a?.summary ?? (b?.verdict === verdict.verdict ? b.summary : null)
      Object.assign(r, {
        status: 'verdict',
        verdict: verdict.verdict,
        score: verdict.score,
        reasons: verdict.reasons,
        reason: top?.text ?? (pc.needsCloud ? 'Not analysed yet' : 'Checked on this Mac'),
        summary: workerSummary ?? this.summary(r, pc, verdict.verdict)
      })
      if (a?.droid) r.droid = a.droid
      // Worker B's excerpts are already in r.code; Worker A's go first.
      if (a?.code?.length) r.code = [...a.code, ...r.code]
      if (a?.findings) {
        r.stage1 = {
          file: { name: intake.name, realType: pc.realType, sha256: pc.sha256, size: pc.size },
          findings: a.findings,
          iocs: [],
          capabilities: a.capabilities ?? [],
          score: verdict.score,
          partial: false
        }
      }
      this.save(r, pc)
      await this.act(r, pc, bytes, intake)
    } catch (err) {
      // Never lose the file: hold it with a clear choice.
      this.deps.log('block', `scan failed scan=${r.id} error=${explain(err)}`)
      Object.assign(r, {
        status: 'failed',
        verdict: 'unknown' as Verdict,
        reason: "Couldn't finish the scan",
        summary: `Aegis couldn't finish scanning this file (${explain(err)}), so it's held.`,
        partial: true
      })
      await this.hold(r, bytes, intake, 'held').catch((e) =>
        this.deps.log('block', `hold failed scan=${r.id} error=${explain(e)}`)
      )
      this.save(r, pc)
    } finally {
      r.durationMs = Date.now() - started
      this.save(r, pc)
      if (live) endLive(live, r)
      this.setActive(-1)
    }
  }

  /** Starts the live view for a file going to the sandbox; no-op emitters without it. */
  private beginLive(r: ScanReport, pc: Precheck): Emitters {
    const hooks = this.deps.live
    if (!hooks) return NO_LIVE()
    hooks.begin({
      scanId: r.id,
      filename: r.filename ?? 'download',
      size: pc.size,
      sha256: pc.sha256
    })
    const em = liveEmitters((body) => hooks.emit(r.id, body))
    em.finish(
      'caught',
      `Held before it reached your Mac · ${pc.size} bytes · SHA-256 ${pc.sha256.slice(0, 12)}…`
    )
    return em
  }

  /** Worker B in Chalk. Never throws: a missing worker is recorded and the other one decides. */
  private async workerB(
    r: ScanReport,
    pc: Precheck,
    bytes: Buffer,
    intake: Intake,
    live: Emitters
  ): Promise<ReturnType<typeof workerBReport> | null> {
    if (!this.deps.workerB) return null
    this.deps.log(null, `worker B start scan=${r.id} (Chalk sandbox, network off)`)
    live.term('aegis', 'note', 'worker B (Chalk) is examining its own copy in a Chalk sandbox')
    let timer: NodeJS.Timeout | undefined
    try {
      const res = await Promise.race([
        this.deps.workerB(bytes, { filename: intake.name, scanId: r.id }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out')),
            this.deps.workerBTimeoutMs ?? WORKER_TIMEOUT_MS
          )
        })
      ])
      const rep = workerBReport(res, intake.name)
      r.checks.push(...rep.checks)
      r.code.push(...rep.code)
      if (rep.sandbox) r.sandbox.push(rep.sandbox)
      this.deps.log(
        rep.verdict === 'malicious' ? 'block' : rep.verdict === 'suspicious' ? 'warn' : null,
        `worker B done scan=${r.id} verdict=${rep.verdict ?? 'none'} analyst=${res.analysis?.analyst ?? 'none'} ` +
          `findings=${rep.reasons.length} sandbox=${res.sandbox_id ?? '-'} ms=${res.ms}` +
          (res.error ? ` error="${res.error}"` : '')
      )
      if (!rep.analysed) r.partial = true
      live.term(
        'aegis',
        rep.verdict === 'malicious' || rep.verdict === 'suspicious' ? 'err' : 'note',
        `worker B (Chalk): ${rep.verdict ?? 'no verdict'}${res.error ? ` · ${res.error}` : ''}`
      )
      return rep
    } catch (err) {
      r.checks.push({
        name: 'Chalk sandbox (Worker B)',
        state: 'fail',
        result: explain(err).slice(0, 80)
      })
      r.partial = true
      this.deps.log('warn', `worker B failed scan=${r.id} error=${explain(err)}`)
      live.term('aegis', 'err', `worker B (Chalk) failed: ${explain(err)}`)
      return null
    } finally {
      clearTimeout(timer)
      this.save(r, pc)
    }
  }

  /** Upload into a fresh network-off sandbox, check it arrived intact, analyse, delete. */
  private async sandbox(
    r: ScanReport,
    pc: Precheck,
    bytes: Buffer,
    intake: Intake,
    live: Emitters
  ): Promise<SandboxAnalysis | null> {
    // A failure before the sandbox stage starts is still the sandbox's.
    const failed = (detail: string): void =>
      live.emit({ kind: 'stage', stage: stageOf(live), state: 'failed', detail })
    const client = await this.deps.sandboxClient().catch(() => null)
    if (!client) {
      r.checks.push({ name: 'Daytona sandbox', state: 'skipped', result: 'not set up' })
      r.partial = true
      this.deps.log('warn', `sandbox skipped scan=${r.id} reason=daytona-not-configured`)
      failed("Daytona isn't set up (DAYTONA_API_KEY), so Worker A can't open it")
      return null
    }
    const release = await this.slot()
    try {
      if (!this.deps.takeSandboxJob()) {
        r.checks.push({ name: 'Daytona sandbox', state: 'skipped', result: 'daily budget used' })
        r.partial = true
        this.deps.log('warn', `sandbox skipped scan=${r.id} reason=budget`)
        failed("Today's sandbox budget is used up, so Worker A can't open it")
        return null
      }
      Object.assign(r, { status: 'analyzing' })
      this.save(r, pc)
      live.enter('sandbox', 'Starting a fresh Daytona sandbox with the network off')
      live.term('aegis', 'cmd', 'daytona create --network-block-all --ephemeral')
      let sandboxId = ''
      let analysis: SandboxAnalysis | null = null
      const job = withSandbox(
        client,
        { labels: { purpose: 'download', scan: r.id }, snapshot: this.deps.snapshot },
        async (session) => {
          sandboxId = session.id
          announceSandbox(session, live)
          live.term('aegis', 'cmd', `upload ${intake.name} → ~/${SAMPLE_PATH}`)
          const sample = await session.upload(bytes, {
            filename: intake.name,
            url: intake.url,
            referrer: intake.referrer,
            contentType: intake.mime
          })
          Object.assign(r, { status: 'uploaded' })
          this.save(r, pc)
          this.deps.log(
            'allow',
            `sandbox upload scan=${r.id} sandbox=${session.id} network=off sha256=verified`
          )
          announceUpload(sample, live)
          // What the sandbox thinks the file is. Reads it; doesn't run it.
          const identified = await session.exec(
            'identify',
            `(command -v file >/dev/null && file -b ${SAMPLE_PATH}) || head -c 32 ${SAMPLE_PATH} | od -An -tx1`
          )
          live.term('aegis', 'cmd', `file -b ${SAMPLE_PATH}`)
          live.term('aegis', 'out', identified.result.trim())
          if (this.deps.analyze) {
            analysis = await this.deps.analyze(session, sample, {
              live,
              run: runsAsShell(intake.name, bytes),
              kind: pc.fileKind
            })
          }
          return sample
        }
      )
      const timeoutMs = this.deps.workerTimeoutMs ?? WORKER_TIMEOUT_MS
      let timer: NodeJS.Timeout | undefined
      const out = await Promise.race([
        job,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
        })
      ]).finally(() => clearTimeout(timer))

      if (!out) {
        r.checks.push({ name: 'Daytona sandbox', state: 'fail', result: 'timed out' })
        r.partial = true
        this.deps.log('warn', `sandbox timed out scan=${r.id} after=${timeoutMs}ms`)
        failed(`Worker A ran out of time after ${secs(timeoutMs)}`)
        // withSandbox still deletes it when the job settles.
        void job.then((late) => this.recordSandbox(r, sandboxId, late.log, late.deleted))
        return null
      }
      this.recordSandbox(r, sandboxId, out.log, out.deleted)
      if (out.log.length) {
        live.term('aegis', 'cmd', 'daytona delete')
        live.term(
          'aegis',
          out.deleted ? 'note' : 'err',
          out.deleted
            ? `sandbox ${sandboxId.slice(0, 8)} deleted`
            : 'could not confirm the sandbox was deleted; check the Daytona dashboard'
        )
      }
      const create = out.log.find((e) => e.step === 'create')
      if (out.error) {
        r.checks.push({ name: 'Daytona sandbox', state: 'fail', result: out.error.slice(0, 80) })
        r.partial = true
        this.deps.log('warn', `sandbox failed scan=${r.id} error=${out.error}`)
        failed(`Worker A couldn't finish: ${out.error}`)
        return null
      }
      // Assigned inside the job above, which TypeScript can't see.
      const done = analysis as SandboxAnalysis | null
      const reviewer = done?.droid?.reviewer
      r.checks.push(
        { name: 'Daytona sandbox', state: 'ok', result: `network off, ${secs(create?.ms ?? 0)}` },
        { name: 'Upload check (SHA-256)', state: 'ok', result: 'matched' },
        done
          ? {
              name: 'Analysis',
              state: reviewer === 'rules' ? 'warn' : 'ok',
              result:
                reviewer === 'droid'
                  ? 'Droid'
                  : reviewer === 'rules'
                    ? "Aegis's checks only"
                    : 'complete'
            }
          : { name: 'Analysis (Worker A)', state: 'skipped', result: 'not set up' }
      )
      if (!analysis) r.partial = true
      this.deps.log(
        out.deleted ? null : 'block',
        `sandbox ${out.deleted ? 'deleted' : 'NOT deleted'} scan=${r.id} sandbox=${sandboxId}`
      )
      return analysis
    } finally {
      release()
    }
  }

  private recordSandbox(
    r: ScanReport,
    sandboxId: string,
    log: SandboxLogEntry[],
    deleted: boolean
  ): void {
    if (!sandboxId) return
    const create = log.find((e) => e.step === 'create')
    const record: SandboxRecord = {
      provider: 'daytona',
      sandboxId,
      image: this.deps.snapshot || 'Daytona default',
      network: 'off',
      startupMs: create?.ms ?? 0,
      runMs: log.filter((e) => e.step !== 'create').reduce((sum, e) => sum + e.ms, 0),
      ran: log.map((e) => `${e.ok ? 'ok' : 'failed'} · ${e.step}: ${e.detail} (${secs(e.ms)})`),
      destroyedAt: deleted ? (log.find((e) => e.step === 'delete')?.at ?? null) : null
    }
    r.sandbox = [...r.sandbox.filter((s) => s.sandboxId !== sandboxId), record]
  }

  private summary(r: ScanReport, pc: Precheck, verdict: Verdict): string {
    if (verdict === 'malicious')
      return `${pc.reasons.find((x) => x.hard)?.text ?? 'Matched a hard rule'}.`
    if (!pc.needsCloud) return 'No threats found, checked on this Mac. It never left this Mac.'
    const uploaded = r.checks.some((c) => c.name === 'Upload check (SHA-256)' && c.state === 'ok')
    if (uploaded) {
      return "Sent to a network-off Daytona sandbox and verified there. Nothing has analysed it yet, so Aegis can't call it clean."
    }
    const why = r.checks.find((c) => c.name === 'Daytona sandbox')?.result ?? 'unavailable'
    return `Aegis can't scan this right now (sandbox ${why}), so it's held.`
  }

  /** Deliver, hold or quarantine (MEGA_PROMPT §5.1 Delivery). */
  private async act(r: ScanReport, pc: Precheck, bytes: Buffer, intake: Intake): Promise<void> {
    const deliver = r.verdict === 'clean' || this.deps.mode() === 'warn'
    if (!deliver) {
      await this.hold(r, bytes, intake, r.verdict === 'malicious' ? 'quarantined' : 'held')
      return
    }
    let path: string
    if (intake.quarantined) {
      path = await this.deps.quarantine.restore(r.id)
    } else {
      // The exact bytes that were scanned; never downloaded again (MEGA_PROMPT §5.1).
      path = await freePath(join(this.deps.downloadsDir, intake.name))
      await writeFile(path, bytes, { flag: 'wx', mode: 0o644 })
    }
    this.deps.ledger.record(path, pc.sha256)
    await (this.deps.markDownloaded ?? ((p) => markDownloadedOnMac(p)))(path, intake.url).catch(
      (err) =>
        this.deps.log('warn', `quarantine attribute not set path=${path} error=${explain(err)}`)
    )
    Object.assign(r, { status: 'done', action: 'delivered' as ScanAction, heldPath: null })
    this.deps.log('allow', `download delivered scan=${r.id} verdict=${r.verdict} path=${path}`)
  }

  private async hold(
    r: ScanReport,
    bytes: Buffer | null,
    intake: Intake,
    action: 'held' | 'quarantined'
  ): Promise<void> {
    let entry = await this.deps.quarantine.get(r.id)
    if (!entry && bytes) {
      entry = await this.deps.quarantine.addBytes(bytes, r.id, {
        originalPath: join(this.deps.downloadsDir, intake.name)
      })
    }
    Object.assign(r, {
      status: r.status === 'failed' ? 'failed' : 'done',
      action,
      heldPath: entry?.path ?? null
    })
    this.deps.log(
      action === 'quarantined' ? 'block' : 'warn',
      `download ${action} scan=${r.id} verdict=${r.verdict} path=${entry?.path ?? '(none)'}`
    )
  }
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

const stageOf = (live: Emitters): LiveStage =>
  live.current() === 'caught' ? 'sandbox' : live.current()

/** The verdict stage and the end of the run; the Report then replaces the live view. */
function endLive(live: Emitters, r: ScanReport): void {
  const summary = r.summary ?? ''
  if (r.status === 'failed') {
    live.emit({ kind: 'stage', stage: stageOf(live), state: 'failed', detail: summary })
  } else {
    live.finish('verdict', summary)
  }
  live.emit({
    kind: 'end',
    ok: r.status !== 'failed',
    verdict: r.verdict,
    summary,
    sandboxDeleted: r.sandbox.every((s) => s.provider !== 'daytona' || s.destroyedAt !== null)
  })
}

function explain(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
