import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { INSPECTOR_TOOLS } from './droidLockdown'
import { REFERENCE_ROWS } from './droidAssets'
import {
  FAMILY_BY_FIRST_EXTENSION,
  extensionOf,
  identifiedFrom,
  matchFileType,
  parseInspectorResult,
  parseReference,
  withoutResultLine
} from './fileTypes'

const reference = readFileSync('resources/droid/file_types_vulnerabilities.md', 'utf8')

describe('the reference', () => {
  const rows = parseReference(reference)

  it('parses every row of the table', () => {
    expect(rows).toHaveLength(16)
    expect(rows[0]).toMatchObject({ extensions: ['c', 'cpp', 'h'], family: 'c' })
    expect(rows.find((r) => r.extensions.includes('pdf'))?.methods).toContain('sandboxed parsing')
  })

  it('is what the app bundles', () => {
    expect(REFERENCE_ROWS).toEqual(rows)
  })

  it('ties every row to a family with a dedicated inspector tool', () => {
    for (const row of rows) {
      expect(row.family, row.extensions.join(' ')).not.toBeNull()
      const tools = INSPECTOR_TOOLS.filter(
        (t) => t.families !== 'all' && t.families.includes(row.family!)
      )
      expect(tools.length, row.family!).toBeGreaterThan(0)
    }
    expect(new Set(rows.map((r) => r.family)).size).toBe(rows.length)
  })

  it('keeps a row Aegis has no check for, without a family', () => {
    const more = parseReference(`${reference}\n| \`.rb\` | Command injection | Brakeman |\n`)
    expect(more.at(-1)).toEqual({
      extensions: ['rb'],
      family: null,
      vulnerabilities: 'Command injection',
      methods: 'Brakeman'
    })
  })

  it('maps first extensions onto families the tools know', () => {
    const known = new Set(INSPECTOR_TOOLS.flatMap((t) => (t.families === 'all' ? [] : t.families)))
    for (const family of Object.values(FAMILY_BY_FIRST_EXTENSION)) expect(known).toContain(family)
  })
})

describe('matching a file to rows', () => {
  const rows = parseReference(reference)

  it('reads extensions, including dotfiles', () => {
    expect(extensionOf('Invoice.PDF')).toBe('pdf')
    expect(extensionOf('.env')).toBe('env')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
    expect(extensionOf('folder/README')).toBe('')
  })

  it('uses the name when the bytes are not known', () => {
    const m = matchFileType(rows, 'report.docx', null)
    expect(m).toMatchObject({
      claimed: 'office',
      detected: null,
      families: ['office'],
      mismatch: false
    })
    expect(m.rows.map((r) => r.extensions[0])).toEqual(['docx'])
  })

  it('adds what the bytes are, and calls out a disguise', () => {
    const m = matchFileType(rows, 'photo.jpg', {
      family: 'shell',
      claimedFamily: 'image',
      label: 'shell script (sh)',
      strong: true
    })
    expect(m.families).toEqual(['image', 'shell'])
    expect(m.rows.map((r) => r.family)).toEqual(['image', 'shell'])
    expect(m.mismatch).toBe(true)
  })

  it("doesn't call a weak guess a disguise", () => {
    const m = matchFileType(rows, 'notes.json', {
      family: 'yaml',
      claimedFamily: 'json',
      label: 'YAML data',
      strong: false
    })
    expect(m.mismatch).toBe(false)
  })

  it("falls back to the inspector's wider extension list", () => {
    const m = matchFileType(rows, 'macro.docm', {
      family: 'office',
      claimedFamily: 'office',
      label: 'Office Open XML document (zip)',
      strong: true
    })
    expect(m.claimed).toBe('office')
    expect(m.families).toEqual(['office'])
  })
})

describe("the inspector's result line", () => {
  const line = (o: unknown): string => `== x ==\nFindings: 1\nAEGIS_RESULT ${JSON.stringify(o)}\n`
  const good = {
    check: 'pdf',
    findings: [
      {
        code: 'pdf_launch',
        severity: 'critical',
        kind: 'malware',
        title: 'Launch action',
        detail: '',
        line: null,
        evidence: '/Launch',
        hard: false
      }
    ],
    facts: { version: '1.7' },
    extra: {}
  }

  it('parses the last line', () => {
    expect(parseInspectorResult(line(good))?.findings[0].code).toBe('pdf_launch')
  })

  it('drops malformed findings and ignores anything that is not the last line', () => {
    const bad = {
      ...good,
      findings: [
        ...good.findings,
        { code: 'x', severity: 'apocalyptic', kind: 'malware', title: 't' }
      ]
    }
    expect(parseInspectorResult(line(bad))?.findings).toHaveLength(1)
    expect(parseInspectorResult(`AEGIS_RESULT ${JSON.stringify(good)}\nmore text`)).toBeNull()
    expect(parseInspectorResult('AEGIS_RESULT {not json')).toBeNull()
  })

  it('is removed from what Droid sees', () => {
    expect(withoutResultLine(line(good))).toBe('== x ==\nFindings: 1\n')
  })

  it('carries the identify verdict', () => {
    const id = {
      check: 'identify',
      findings: [],
      facts: {},
      extra: { family: 'pdf', claimedFamily: 'pdf', label: 'PDF document', strong: true }
    }
    expect(identifiedFrom(parseInspectorResult(line(id)))).toEqual({
      family: 'pdf',
      claimedFamily: 'pdf',
      label: 'PDF document',
      strong: true
    })
    expect(identifiedFrom(parseInspectorResult(line(good)))).toBeNull()
  })
})
