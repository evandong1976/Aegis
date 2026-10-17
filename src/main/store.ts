// SQLite store on node:sqlite (built into Electron 44's Node 24, no native rebuild needed).
// Migrations are numbered, run in order once each, and each is idempotent.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type {
  DayCounts,
  FileTab,
  LinkTab,
  OverviewStats,
  ScanQuery,
  TrustedSite
} from '@shared/ipc'
import type { ScanReport, ScanSummary } from '@shared/types'

const MIGRATIONS: string[] = [
  // 1: schema (BUILD_PROMPT §4.3, plus the columns the Overview / Links / Downloads screens show)
  `
  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('download','quarantine','link','message')),
    source TEXT NOT NULL CHECK (source IN ('chrome','watcher','photon')),
    seen_in TEXT NOT NULL,
    url TEXT,
    filename TEXT,
    file_kind TEXT,
    file_category TEXT,
    sha256 TEXT,
    size INTEGER,
    real_type TEXT,
    status TEXT NOT NULL,
    action TEXT NOT NULL,
    verdict TEXT CHECK (verdict IS NULL OR verdict IN ('clean','unknown','suspicious','malicious')),
    score INTEGER,
    reason TEXT,
    summary TEXT,
    reasons TEXT NOT NULL DEFAULT '[]',
    stage1 TEXT,
    droid TEXT,
    report TEXT NOT NULL DEFAULT '{}',
    caught_by TEXT,
    sandboxed INTEGER NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 0,
    held_path TEXT,
    user_decision TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scans_created_at ON scans (created_at DESC);
  CREATE INDEX IF NOT EXISTS scans_kind_action ON scans (kind, action);
  CREATE INDEX IF NOT EXISTS scans_sha256 ON scans (sha256);

  CREATE TABLE IF NOT EXISTS link_checks (
    url_stripped TEXT NOT NULL,
    domain TEXT NOT NULL,
    verdict TEXT NOT NULL,
    score INTEGER NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    features TEXT NOT NULL DEFAULT '{}',
    checked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS link_checks_domain ON link_checks (domain, checked_at DESC);

  CREATE TABLE IF NOT EXISTS detonations (
    id TEXT PRIMARY KEY,
    scan_id TEXT REFERENCES scans (id),
    url TEXT NOT NULL,
    final_url TEXT,
    redirects TEXT NOT NULL DEFAULT '[]',
    screenshot_path TEXT,
    title TEXT,
    password_forms TEXT NOT NULL DEFAULT '[]',
    hosts TEXT NOT NULL DEFAULT '[]',
    cloaking_suspected INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trusted_sites (
    domain TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('imessage','sms','email','voice')),
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    body TEXT NOT NULL,
    scan_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_id, created_at);

  CREATE TABLE IF NOT EXISTS sandbox_usage (
    date TEXT PRIMARY KEY,
    jobs INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]

const ALL_TABLES = [
  'scans',
  'link_checks',
  'detonations',
  'trusted_sites',
  'messages',
  'sandbox_usage',
  'settings',
  'schema_migrations'
]

/**
 * The first skeleton (branch milestone-0-skeleton) shipped a migration 1 with the old
 * none/caution/danger vocabulary. Nothing real was ever stored in it, so a database in that
 * shape is rebuilt rather than migrated.
 */
function resetPreReleaseSchema(db: DatabaseSync): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('scans')").all() as Array<{
    name: string
  }>
  if (cols.length > 0 && !cols.some((c) => c.name === 'action')) {
    for (const t of ALL_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`)
  }
}

export function migrate(db: DatabaseSync): number {
  resetPreReleaseSchema(db)
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  )
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null
  }
  let version = row.v ?? 0
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        i + 1,
        new Date().toISOString()
      )
      db.exec('COMMIT')
      version = i + 1
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return version
}

interface ScanRow {
  id: string
  kind: ScanSummary['kind']
  source: ScanSummary['source']
  seen_in: string
  url: string | null
  filename: string | null
  file_kind: string | null
  size: number | null
  status: ScanSummary['status']
  action: ScanSummary['action']
  verdict: ScanSummary['verdict']
  score: number | null
  reason: string | null
  duration_ms: number | null
  created_at: string
  updated_at: string
}

interface ScanDetailRow extends ScanRow {
  summary: string | null
  reasons: string
  stage1: string | null
  droid: string | null
  report: string
  partial: number
  held_path: string | null
}

const SUMMARY_COLUMNS =
  'id, kind, source, seen_in, url, filename, file_kind, size, status, action, verdict, score, reason, duration_ms, created_at, updated_at'

function toSummary(r: ScanRow): ScanSummary {
  return {
    id: r.id,
    kind: r.kind,
    source: r.source,
    seenIn: r.seen_in,
    url: r.url,
    filename: r.filename,
    fileKind: r.file_kind,
    size: r.size,
    status: r.status,
    verdict: r.verdict,
    score: r.score,
    reason: r.reason,
    action: r.action,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const FILE_KINDS = "('download','quarantine')"

const LINK_TABS: Record<LinkTab, string> = {
  held: "action = 'held'",
  blocked: "action = 'blocked'",
  allowed: "action IN ('allowed','delivered','restored')",
  all: '1 = 1'
}
const FILE_TABS: Record<FileTab, string> = {
  held: "action = 'held'",
  quarantined: "action = 'quarantined'",
  delivered: "action IN ('delivered','restored')",
  all: '1 = 1'
}

/** What the report JSON column holds: the parts of ScanReport without their own column. */
type ReportExtras = Pick<ScanReport, 'indicators' | 'code' | 'checks' | 'sandbox'>

export interface Store {
  db: DatabaseSync
  schemaVersion: number
  getSetting(key: string): string | undefined
  setSetting(key: string, value: string): void
  listScans(query: ScanQuery): ScanSummary[]
  getScan(id: string): ScanReport | null
  putScan(
    report: ScanReport,
    extra?: { fileCategory?: string | null; caughtBy?: string | null }
  ): void
  overview(now?: Date): OverviewStats
  listTrusted(): TrustedSite[]
  addTrusted(domain: string): void
  removeTrusted(domain: string): void
  /** Counts one sandbox job for today if under `limit`; false once the daily budget is used. */
  takeSandboxJob(limit: number, now?: Date): boolean
  close(): void
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Opens (or creates) the store at `path`; pass ':memory:' in tests. */
export function openStore(path: string): Store {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const schemaVersion = migrate(db)

  const count = (where: string, params: SQLInputValue[]): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM scans WHERE ${where}`).get(...params) as { n: number }).n

  function dayCounts(from: Date, to: Date): DayCounts {
    const range = 'created_at >= ? AND created_at < ?'
    const p = [from.toISOString(), to.toISOString()]
    const link = `kind = 'link' AND ${range}`
    const file = `kind IN ${FILE_KINDS} AND ${range}`
    const durations = (
      db
        .prepare(`SELECT duration_ms AS d FROM scans WHERE ${link} AND duration_ms IS NOT NULL`)
        .all(...p) as Array<{ d: number }>
    ).map((r) => r.d)
    return {
      linksChecked: count(link, p),
      linksBlocked: count(`${link} AND action = 'blocked'`, p),
      linksHeld: count(`${link} AND action = 'held'`, p),
      filesScanned: count(file, p),
      filesHeld: count(`${file} AND action = 'held'`, p),
      filesQuarantined: count(`${file} AND action = 'quarantined'`, p),
      filesSandboxed: count(`${file} AND sandboxed = 1`, p),
      linkMedianMs: median(durations)
    }
  }

  return {
    db,
    schemaVersion,
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
      return row?.value
    },
    setSetting(key, value) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
      ).run(key, value)
    },
    listScans({ kind, tab = 'all', search, limit = 100 }) {
      const where: string[] = []
      const params: SQLInputValue[] = []
      if (kind === 'link') {
        where.push("kind = 'link'", LINK_TABS[tab as LinkTab] ?? '1 = 1')
      } else if (kind === 'file') {
        where.push(`kind IN ${FILE_KINDS}`, FILE_TABS[tab as FileTab] ?? '1 = 1')
      }
      if (search?.trim()) {
        where.push('(url LIKE ? OR filename LIKE ? OR sha256 LIKE ?)')
        const like = `%${search.trim()}%`
        params.push(like, like, like)
      }
      params.push(Math.min(Math.max(limit, 1), 500))
      const rows = db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM scans ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`
        )
        .all(...params) as unknown as ScanRow[]
      return rows.map(toSummary)
    },
    getScan(id) {
      const r = db.prepare('SELECT * FROM scans WHERE id = ?').get(id) as unknown as
        ScanDetailRow | undefined
      if (!r) return null
      const extras = JSON.parse(r.report) as Partial<ReportExtras>
      return {
        ...toSummary(r),
        summary: r.summary,
        reasons: JSON.parse(r.reasons),
        stage1: r.stage1 ? JSON.parse(r.stage1) : null,
        droid: r.droid ? JSON.parse(r.droid) : null,
        indicators: extras.indicators ?? {
          sha256: null,
          realType: null,
          claimedType: null,
          signature: null,
          size: r.size,
          firstSeen: r.created_at
        },
        code: extras.code ?? [],
        checks: extras.checks ?? [],
        sandbox: extras.sandbox ?? [],
        partial: r.partial === 1,
        heldPath: r.held_path
      }
    },
    putScan(s, extra = {}) {
      const report: ReportExtras = {
        indicators: s.indicators,
        code: s.code,
        checks: s.checks,
        sandbox: s.sandbox
      }
      db.prepare(
        `INSERT INTO scans (id, kind, source, seen_in, url, filename, file_kind, file_category, sha256, size,
          real_type, status, action, verdict, score, reason, summary, reasons, stage1, droid, report, caught_by,
          sandboxed, partial, held_path, duration_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET file_kind = excluded.file_kind,
          file_category = excluded.file_category, sha256 = excluded.sha256, size = excluded.size,
          real_type = excluded.real_type, status = excluded.status, action = excluded.action,
          verdict = excluded.verdict, score = excluded.score, reason = excluded.reason,
          summary = excluded.summary, reasons = excluded.reasons, stage1 = excluded.stage1,
          droid = excluded.droid, report = excluded.report, caught_by = excluded.caught_by,
          sandboxed = excluded.sandboxed, partial = excluded.partial, held_path = excluded.held_path,
          duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`
      ).run(
        s.id,
        s.kind,
        s.source,
        s.seenIn,
        s.url,
        s.filename,
        s.fileKind,
        extra.fileCategory ?? null,
        s.indicators.sha256,
        s.size,
        s.indicators.realType,
        s.status,
        s.action,
        s.verdict,
        s.score,
        s.reason,
        s.summary,
        JSON.stringify(s.reasons),
        s.stage1 ? JSON.stringify(s.stage1) : null,
        s.droid ? JSON.stringify(s.droid) : null,
        JSON.stringify(report),
        extra.caughtBy ?? null,
        s.sandbox.length > 0 ? 1 : 0,
        s.partial ? 1 : 0,
        s.heldPath,
        s.durationMs,
        s.createdAt,
        s.updatedAt
      )
    },
    overview(now = new Date()) {
      const today = startOfDay(now)
      const tomorrow = addDays(today, 1)
      const p = [today.toISOString(), tomorrow.toISOString()]
      const spark = { links: [] as number[], files: [] as number[] }
      for (let i = 7; i >= 0; i--) {
        const from = addDays(today, -i)
        const to = addDays(from, 1)
        const q = [from.toISOString(), to.toISOString()]
        spark.links.push(count("kind = 'link' AND created_at >= ? AND created_at < ?", q))
        spark.files.push(count(`kind IN ${FILE_KINDS} AND created_at >= ? AND created_at < ?`, q))
      }
      const tabCount = (kind: string, tabs: Record<string, string>): Record<string, number> =>
        Object.fromEntries(Object.entries(tabs).map(([k, w]) => [k, count(`${kind} AND ${w}`, [])]))
      return {
        today: dayCounts(today, tomorrow),
        yesterday: dayCounts(addDays(today, -1), today),
        spark,
        waiting: {
          links: count("kind = 'link' AND action = 'held'", []),
          files: count(`kind IN ${FILE_KINDS} AND action IN ('held','quarantined')`, [])
        },
        tabCounts: {
          links: tabCount("kind = 'link'", LINK_TABS) as Record<LinkTab, number>,
          files: tabCount(`kind IN ${FILE_KINDS}`, FILE_TABS) as Record<FileTab, number>
        },
        caughtBy: (
          db
            .prepare(
              `SELECT caught_by AS engine, COUNT(*) AS files FROM scans WHERE kind IN ${FILE_KINDS}
               AND caught_by IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY caught_by ORDER BY files DESC`
            )
            .all(...p) as Array<{ engine: string; files: number }>
        ).map((r) => ({ engine: r.engine, files: r.files })),
        byType: (
          db
            .prepare(
              `SELECT file_category AS category, COUNT(*) AS files FROM scans WHERE kind IN ${FILE_KINDS}
               AND file_category IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY file_category ORDER BY files DESC`
            )
            .all(...p) as Array<{ category: string; files: number }>
        ).map((r) => ({ category: r.category, files: r.files }))
      }
    },
    listTrusted() {
      const rows = db
        .prepare('SELECT domain, added_at FROM trusted_sites ORDER BY domain')
        .all() as unknown as Array<{ domain: string; added_at: string }>
      return rows.map((r) => ({ domain: r.domain, addedAt: r.added_at }))
    },
    addTrusted(domain) {
      db.prepare('INSERT OR IGNORE INTO trusted_sites (domain, added_at) VALUES (?, ?)').run(
        domain.toLowerCase(),
        new Date().toISOString()
      )
    },
    removeTrusted(domain) {
      db.prepare('DELETE FROM trusted_sites WHERE domain = ?').run(domain.toLowerCase())
    },
    takeSandboxJob(limit, now = new Date()) {
      // The local date, so the budget resets at the user's midnight.
      const pad = (n: number): string => String(n).padStart(2, '0')
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const used =
        (
          db.prepare('SELECT jobs FROM sandbox_usage WHERE date = ?').get(date) as
            { jobs: number } | undefined
        )?.jobs ?? 0
      if (used >= limit) return false
      db.prepare(
        'INSERT INTO sandbox_usage (date, jobs) VALUES (?, 1) ON CONFLICT (date) DO UPDATE SET jobs = jobs + 1'
      ).run(date)
      return true
    },
    close() {
      db.close()
    }
  }
}
