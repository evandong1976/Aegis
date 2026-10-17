import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { ScanReport } from '@shared/types'
import { seedDemo } from './demo'
import { migrate, openStore } from './store'

function scan(over: Partial<ScanReport> = {}): ScanReport {
  const at = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    kind: 'download',
    source: 'chrome',
    seenIn: 'Chrome',
    url: 'https://example.com/a.pkg',
    filename: 'a.pkg',
    fileKind: 'Installer',
    size: 1024,
    status: 'done',
    verdict: 'suspicious',
    score: 50,
    reason: 'Unsigned',
    action: 'held',
    durationMs: 9000,
    createdAt: at,
    updatedAt: at,
    summary: 'This installer would add itself to your login items.',
    reasons: [{ code: 'unsigned', text: 'Unsigned', weight: 20, hard: false }],
    stage1: null,
    droid: null,
    indicators: {
      sha256: 'abc123',
      realType: 'xar archive',
      claimedType: 'Installer',
      signature: 'Unsigned',
      size: 1024,
      firstSeen: at
    },
    code: [],
    checks: [{ name: 'Local pre-check', state: 'ok', result: 'passed' }],
    sandbox: [],
    partial: false,
    heldPath: null,
    ...over
  }
}

describe('store', () => {
  it('creates every table from BUILD_PROMPT §4.3', () => {
    const store = openStore(':memory:')
    const tables = (
      store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((t) => t.name)
    for (const t of [
      'scans',
      'link_checks',
      'detonations',
      'trusted_sites',
      'messages',
      'sandbox_usage',
      'settings'
    ]) {
      expect(tables).toContain(t)
    }
    store.close()
  })

  it('migrations are idempotent', () => {
    const db = new DatabaseSync(':memory:')
    const v1 = migrate(db)
    const v2 = migrate(db)
    expect(v2).toBe(v1)
    db.close()
  })

  it('rebuilds the pre-release none/caution/danger schema', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE scans (id TEXT PRIMARY KEY, verdict TEXT CHECK (verdict IN ('none','caution','danger')));
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES (1, 'then');`)
    migrate(db)
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('scans')").all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toContain('action')
    db.close()
  })

  it('rejects verdicts outside the four words', () => {
    const store = openStore(':memory:')
    expect(() => store.putScan(scan({ verdict: 'danger' as never }))).toThrow()
    store.close()
  })

  it('round-trips a report', () => {
    const store = openStore(':memory:')
    const s = scan()
    store.putScan(s)
    const back = store.getScan(s.id)
    expect(back).toMatchObject({
      verdict: 'suspicious',
      action: 'held',
      summary: s.summary,
      indicators: s.indicators,
      checks: s.checks
    })
    expect(store.getScan('missing')).toBeNull()
    store.close()
  })

  it('filters by tab and search', () => {
    const store = openStore(':memory:')
    store.putScan(scan({ filename: 'held.pkg', action: 'held' }))
    store.putScan(scan({ filename: 'bad.iso', action: 'quarantined', verdict: 'malicious' }))
    store.putScan(
      scan({
        kind: 'link',
        url: 'https://phish.sbs/',
        filename: null,
        action: 'blocked',
        indicators: {
          sha256: null,
          realType: null,
          claimedType: null,
          signature: null,
          size: null,
          firstSeen: null
        }
      })
    )
    expect(store.listScans({ kind: 'file', tab: 'held' }).map((s) => s.filename)).toEqual([
      'held.pkg'
    ])
    expect(store.listScans({ kind: 'file', tab: 'quarantined' })).toHaveLength(1)
    expect(store.listScans({ kind: 'link', tab: 'blocked' })).toHaveLength(1)
    expect(store.listScans({ kind: 'any', search: 'phish' })).toHaveLength(1)
    expect(store.listScans({ kind: 'any', search: 'abc12' })).toHaveLength(2)
    store.close()
  })

  it('computes the overview counts', () => {
    const store = openStore(':memory:')
    seedDemo(store)
    const o = store.overview()
    expect(o.today.linksChecked).toBe(7)
    expect(o.today.linksBlocked).toBe(2)
    expect(o.waiting).toEqual({ links: 2, files: 4 })
    expect(o.tabCounts.files.quarantined).toBe(2)
    expect(o.today.filesSandboxed).toBe(1)
    expect(o.today.linkMedianMs).toBe(1180)
    expect(o.spark.links).toHaveLength(8)
    store.close()
  })

  it('stores settings and trusted sites', () => {
    const store = openStore(':memory:')
    store.setSetting('mode', 'warn')
    store.setSetting('mode', 'block')
    expect(store.getSetting('mode')).toBe('block')
    store.addTrusted('Example.com')
    store.addTrusted('example.com')
    expect(store.listTrusted().map((t) => t.domain)).toEqual(['example.com'])
    store.removeTrusted('example.com')
    expect(store.listTrusted()).toEqual([])
    store.close()
  })
})
