import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, openStore } from './store'

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
