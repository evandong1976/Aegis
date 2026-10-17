import { describe, expect, it } from 'vitest'
import { documentRisks, precheck, sniff } from './precheck'

const MACHO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const zipWith = (...names: string[]): Buffer =>
  Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from(names.join('\0'), 'latin1')])

describe('real type from the bytes', () => {
  it('knows programs, scripts, archives and documents', () => {
    expect(sniff(Buffer.from('MZ\x90\x00', 'latin1'))).toBe('pe')
    expect(sniff(Buffer.from('\x7fELF\x02', 'latin1'))).toBe('elf')
    expect(sniff(MACHO)).toBe('macho')
    expect(sniff(Buffer.from('#!/bin/sh\necho hi\n'))).toBe('script')
    expect(sniff(zipWith('word/document.xml'))).toBe('zip')
    expect(sniff(Buffer.from('%PDF-1.7\n'))).toBe('pdf')
    expect(sniff(Buffer.from('xar!\x00\x1c', 'latin1'))).toBe('xar')
    expect(sniff(Buffer.from('<!DOCTYPE html><p>hi'))).toBe('html')
    expect(sniff(Buffer.from('plain words\n'))).toBe('text')
  })
})

describe('the pre-check decision', () => {
  it('sends scripts and programs to the sandbox', () => {
    const pc = precheck('update.command', Buffer.from('#!/bin/sh\necho hi\n'))
    expect(pc).toMatchObject({ needsCloud: true, fileKind: 'Script', category: 'Script' })
    expect(pc.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(precheck('Setup.pkg', Buffer.from('xar!\x00\x1c', 'latin1')).needsCloud).toBe(true)
  })

  it('clears a plain document on this Mac (never uploaded)', () => {
    const pc = precheck('statement.pdf', Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >>\n'))
    expect(pc).toMatchObject({ needsCloud: false, category: 'Document', documentRisks: [] })
  })

  it('sends a document with a macro or a PDF action to the sandbox', () => {
    const macro = precheck('Q3.xlsm', zipWith('xl/workbook.xml', 'xl/vbaProject.bin'))
    expect(macro.needsCloud).toBe(true)
    expect(macro.documentRisks).toContain('a macro (vbaProject.bin)')
    const pdf = precheck('invoice.pdf', Buffer.from('%PDF-1.4\n<< /OpenAction 5 0 R /JS (x) >>'))
    expect(pdf.needsCloud).toBe(true)
    expect(pdf.documentRisks).toEqual(['a PDF action (/JS)', 'a PDF action (/OpenAction)'])
    // `/JSON` isn't `/JS`.
    expect(documentRisks(Buffer.from('%PDF-1.4 /JSONData'), 'pdf')).toEqual([])
  })

  it('makes a document or photo that is really a program a hard rule', () => {
    const pc = precheck('invoice.pdf', MACHO)
    expect(pc.needsCloud).toBe(true)
    expect(pc.reasons).toEqual([expect.objectContaining({ code: 'type_mismatch', hard: true })])
    expect(precheck('photo.jpg', MACHO).reasons[0]?.hard).toBe(true)
  })

  it('passes media only when the bytes confirm it', () => {
    expect(precheck('photo.jpg', JPEG).needsCloud).toBe(false)
    expect(precheck('photo.jpg', Buffer.from('not a jpeg')).needsCloud).toBe(true)
  })

  it('sends a PDF that is really something else to the sandbox', () => {
    expect(precheck('report.pdf', Buffer.from('<!doctype html>')).needsCloud).toBe(true)
  })
})
