// Local pre-check (MEGA_PROMPT §5.3, architectural.md §4.4 step 3): reads a file's bytes on this
// Mac without opening or running them, and decides whether it needs the sandbox. Real type from
// magic bytes, SHA-256, size, and for documents whether they carry macros, embedded objects or PDF
// actions.
//
// - Media whose bytes match their name pass straight through.
// - Documents with nothing risky are cleared here and never uploaded (privacy rule 10).
// - Everything else goes to the sandbox.

import { createHash } from 'crypto'
import { extname } from 'path'
import { ALWAYS_SCAN_EXTENSIONS, PASS_THROUGH_EXTENSIONS } from '@shared/constants'
import type { Reason } from '@shared/types'
import { mediaMatches } from './watcher'

export type RealType =
  | 'pe'
  | 'elf'
  | 'macho'
  | 'script'
  | 'zip'
  | 'ole'
  | 'pdf'
  | 'rtf'
  | 'xar'
  | 'dmg'
  | 'iso'
  | 'gzip'
  | '7z'
  | 'rar'
  | 'html'
  | 'media'
  | 'text'
  | 'unknown'

export interface Precheck {
  sha256: string
  size: number
  /** Lower-case extension from the name, without the dot ('' if none). */
  ext: string
  realType: RealType
  /** For people: "Script", "Installer", "Disc image". */
  fileKind: string
  /** For the Downloads screen's "By file type": Installer, Script, Archive, Document, Web file, Media, Other. */
  category: string
  /** Risky things found in a document: "a macro (vbaProject.bin)", "a PDF action (/OpenAction)". */
  documentRisks: string[]
  /** Rule reasons for verdict.ts (hard ones make it malicious). */
  reasons: Reason[]
  /** False when the file was cleared on this Mac and stays here. */
  needsCloud: boolean
  /** Why, one line, for the log and the report. */
  why: string
}

const EXECUTABLE_TYPES: RealType[] = ['pe', 'elf', 'macho']

const has = (list: readonly string[], ext: string): boolean => list.includes(ext)
const ascii = (b: Buffer, at: number, text: string): boolean =>
  b.length >= at + text.length && b.toString('latin1', at, at + text.length) === text

/** The real type of a file from its first bytes (and, for disc images, its last 512). */
export function sniff(bytes: Buffer): RealType {
  if (ascii(bytes, 0, 'MZ')) return 'pe'
  if (ascii(bytes, 0, '\x7fELF')) return 'elf'
  const magic = bytes.length >= 4 ? bytes.readUInt32BE(0) : 0
  // Mach-O 32/64 in both byte orders, and fat binaries (0xcafebabe is also a Java class file,
  // which is rare in a download and is code either way).
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'macho'
  if (ascii(bytes, 0, '#!')) return 'script'
  if (ascii(bytes, 0, 'PK\x03\x04') || ascii(bytes, 0, 'PK\x05\x06')) return 'zip'
  if (magic === 0xd0cf11e0) return 'ole'
  if (bytes.subarray(0, 1024).includes('%PDF-')) return 'pdf'
  if (ascii(bytes, 0, '{\\rtf')) return 'rtf'
  if (ascii(bytes, 0, 'xar!')) return 'xar'
  if (ascii(bytes, 0, '7z\xbc\xaf\x27\x1c')) return '7z'
  if (ascii(bytes, 0, 'Rar!')) return 'rar'
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip'
  if (ascii(bytes, 0x8001, 'CD001')) return 'iso'
  if (bytes.length >= 512 && ascii(bytes, bytes.length - 512, 'koly')) return 'dmg'
  const head = bytes.subarray(0, 512).toString('latin1').trimStart().toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
  if (isText(bytes.subarray(0, 4096))) return 'text'
  return 'unknown'
}

function isText(b: Buffer): boolean {
  if (b.length === 0) return false
  let odd = 0
  for (const c of b) {
    if (c === 0) return false
    if (c < 9 || (c > 13 && c < 32)) odd++
  }
  return odd / b.length < 0.02
}

/** Macros, embedded objects and actions in documents. Reads bytes only. */
export function documentRisks(bytes: Buffer, realType: RealType): string[] {
  const risks: string[] = []
  const find = (needle: string, enc: BufferEncoding = 'latin1'): boolean =>
    bytes.includes(Buffer.from(needle, enc))
  if (realType === 'pdf') {
    for (const key of ['/JavaScript', '/JS', '/OpenAction', '/Launch', '/EmbeddedFile', '/AA']) {
      // `/JS` must be a whole name, not the start of `/JSON…`.
      const re = new RegExp(`${key.replace('/', '\\/')}(?![A-Za-z])`)
      if (re.test(bytes.toString('latin1'))) risks.push(`a PDF action (${key})`)
    }
  }
  if (realType === 'zip') {
    // Office files are zips; their part names are stored as plain text.
    if (find('vbaProject.bin')) risks.push('a macro (vbaProject.bin)')
    if (find('oleObject') || find('/embeddings/')) risks.push('an embedded object')
  }
  if (realType === 'ole') {
    // Directory entry names in an OLE file are UTF-16LE.
    if (find('_VBA_PROJECT', 'utf16le') || find('Macros', 'utf16le')) risks.push('a macro')
    if (find('Ole10Native', 'utf16le')) risks.push('an embedded object')
  }
  if (realType === 'rtf' && (find('\\object') || find('\\objdata'))) {
    risks.push('an embedded object')
  }
  return risks
}

const OFFICE = ['doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'one']

/** Does the real type fit a document of this extension? */
function documentTypeFits(ext: string, real: RealType): boolean {
  if (ext === 'pdf') return real === 'pdf'
  if (ext === 'rtf') return real === 'rtf'
  if (OFFICE.includes(ext)) return real === 'zip' || real === 'ole'
  return false
}

function describe(ext: string, real: RealType): { fileKind: string; category: string } {
  if (EXECUTABLE_TYPES.includes(real) || has(ALWAYS_SCAN_EXTENSIONS.executables, ext)) {
    if (['dmg', 'iso', 'img'].includes(ext))
      return { fileKind: 'Disc image', category: 'Installer' }
    if (['pkg', 'mpkg', 'msi', 'deb', 'rpm'].includes(ext)) {
      return { fileKind: 'Installer', category: 'Installer' }
    }
    return { fileKind: 'Executable', category: 'Installer' }
  }
  if (real === 'xar') return { fileKind: 'Installer', category: 'Installer' }
  if (real === 'dmg' || real === 'iso') return { fileKind: 'Disc image', category: 'Installer' }
  if (has(ALWAYS_SCAN_EXTENSIONS.scripts, ext) || real === 'script') {
    return { fileKind: 'Script', category: 'Script' }
  }
  if (has(ALWAYS_SCAN_EXTENSIONS.archives, ext)) return { fileKind: 'Archive', category: 'Archive' }
  if (ext === 'pdf') return { fileKind: 'PDF', category: 'Document' }
  if (['xls', 'xlsx', 'xlsm'].includes(ext))
    return { fileKind: 'Spreadsheet', category: 'Document' }
  if (['ppt', 'pptx'].includes(ext)) return { fileKind: 'Presentation', category: 'Document' }
  if (has(ALWAYS_SCAN_EXTENSIONS.documents, ext))
    return { fileKind: 'Document', category: 'Document' }
  if (has(ALWAYS_SCAN_EXTENSIONS.web, ext)) return { fileKind: 'Web file', category: 'Web file' }
  for (const [family, exts] of Object.entries(PASS_THROUGH_EXTENSIONS)) {
    if (has(exts, ext)) {
      return {
        fileKind: family === 'images' ? 'Image' : family === 'audio' ? 'Audio' : 'Video',
        category: 'Media'
      }
    }
  }
  if (['zip', 'gzip', '7z', 'rar'].includes(real))
    return { fileKind: 'Archive', category: 'Archive' }
  return { fileKind: ext ? `.${ext} file` : 'File', category: 'Other' }
}

export function precheck(name: string, bytes: Buffer): Precheck {
  const ext = extname(name).slice(1).toLowerCase()
  const realType = sniff(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const { fileKind, category } = describe(ext, realType)
  const base = { sha256, size: bytes.length, ext, realType, fileKind, category }
  const reasons: Reason[] = []

  // A document or media file that is really a program is a hard rule (MEGA_PROMPT §5.3).
  const claimsHarmless =
    has(ALWAYS_SCAN_EXTENSIONS.documents, ext) ||
    Object.values(PASS_THROUGH_EXTENSIONS).some((exts) => has(exts, ext))
  if (claimsHarmless && EXECUTABLE_TYPES.includes(realType)) {
    reasons.push({
      code: 'type_mismatch',
      text: `named .${ext} but is really a ${realType === 'macho' ? 'Mac' : realType.toUpperCase()} program`,
      weight: 70,
      hard: true
    })
    return {
      ...base,
      documentRisks: [],
      reasons,
      needsCloud: true,
      why: `.${ext} file that is really a program`
    }
  }

  for (const exts of Object.values(PASS_THROUGH_EXTENSIONS)) {
    if (!has(exts, ext)) continue
    if (mediaMatches(ext, bytes.subarray(0, 64))) {
      return {
        ...base,
        documentRisks: [],
        reasons,
        needsCloud: false,
        why: 'media, type confirmed'
      }
    }
    return {
      ...base,
      documentRisks: [],
      reasons,
      needsCloud: true,
      why: `.${ext} file whose bytes don't match its type`
    }
  }

  if (has(ALWAYS_SCAN_EXTENSIONS.documents, ext) && documentTypeFits(ext, realType)) {
    const risks = documentRisks(bytes, realType)
    if (risks.length === 0) {
      return {
        ...base,
        documentRisks: risks,
        reasons,
        needsCloud: false,
        why: 'document with no macros, embedded objects or actions'
      }
    }
    for (const r of risks) {
      reasons.push({ code: 'document_risk', text: `contains ${r}`, weight: 20, hard: false })
    }
    return {
      ...base,
      documentRisks: risks,
      reasons,
      needsCloud: true,
      why: `document with ${risks.join(', ')}`
    }
  }

  return {
    ...base,
    documentRisks: [],
    reasons,
    needsCloud: true,
    why: `${fileKind.toLowerCase()} (${realType === 'unknown' ? 'unrecognised bytes' : realType})`
  }
}
