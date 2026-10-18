// File type → reference rows → tools (resources/droid/file_types_vulnerabilities.md).
//
// The reference's table is the source of truth: it is parsed here, so a row added or reworded
// there reaches both Droid's prompt and the tool choice. Each row is tied to a family by its first
// extension; a family names the inspector check (sandbox/aegis_inspect.py) that implements the
// row's methods. A row with no family still goes to Droid, with the general tools only.
//
// The file's family comes from its name (this table) and from its bytes (the inspector's
// `identify` check, run in the sandbox). Both count: the reference says an extension doesn't
// establish a vulnerability, and a disguised file is judged by what it really is.
//
// No `@shared` imports and `.ts` extensions on local imports: scripts/try-analyst.mts runs this
// file directly under Node.

/** One row of the reference table. */
export interface ReferenceRow {
  /** Lower case, without the dot, as the row lists them. */
  extensions: string[]
  /** The inspector family for this row, or null if Aegis has no dedicated check for it yet. */
  family: string | null
  vulnerabilities: string
  methods: string
}

/** A row's family, from the first extension it lists. Families match aegis_inspect.py's checks. */
export const FAMILY_BY_FIRST_EXTENSION: Readonly<Record<string, string>> = {
  c: 'c',
  py: 'python',
  js: 'javascript',
  php: 'php',
  sql: 'sql',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  zip: 'archive',
  pdf: 'pdf',
  docx: 'office',
  jpg: 'image',
  env: 'config',
  sh: 'shell',
  pem: 'keys',
  wasm: 'binary'
}

/** Parses the reference's table. Rows without a backticked extension are skipped. */
export function parseReference(markdown: string): ReferenceRow[] {
  const rows: ReferenceRow[] = []
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.length < 3) continue
    const extensions = [...cells[0].matchAll(/`\.?([A-Za-z0-9_+-]+)`/g)].map((m) =>
      m[1].toLowerCase()
    )
    if (!extensions.length) continue
    rows.push({
      extensions,
      family: FAMILY_BY_FIRST_EXTENSION[extensions[0]] ?? null,
      vulnerabilities: cells[1],
      methods: cells[2]
    })
  }
  return rows
}

/** Lower-case extension of a file name, without the dot ('' if none). ".env" is "env". */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** What the inspector's `identify` check said about the bytes. */
export interface Identified {
  /** Family from the magic bytes or content, or null. */
  family: string | null
  /** Family from the name, by the inspector's wider extension list (.jpeg, .docm, .ps1…). */
  claimedFamily: string | null
  /** "PDF document", "shell script (sh)". */
  label: string
  /** True when the bytes carry a magic number, not a guess from text. */
  strong: boolean
}

export interface FileTypeMatch {
  ext: string
  /** Family from the name. */
  claimed: string | null
  /** Family from the bytes. */
  detected: string | null
  /** What the bytes are, for people. */
  label: string
  /** Every family that applies: what the name says and what the bytes are. */
  families: string[]
  /** The reference rows for those families (or the row listing this extension). */
  rows: ReferenceRow[]
  /** The name and the bytes disagree (only claimed when the bytes carry a magic number). */
  mismatch: boolean
}

/** The reference rows and families that apply to a file. */
export function matchFileType(
  rows: ReferenceRow[],
  filename: string,
  identified: Identified | null
): FileTypeMatch {
  const ext = extensionOf(filename)
  const byName = rows.find((r) => r.extensions.includes(ext))
  const claimed = byName?.family ?? identified?.claimedFamily ?? null
  const detected = identified?.family ?? null
  const families = [...new Set([claimed, detected].filter((f): f is string => Boolean(f)))]
  const matched = rows.filter((r) => (r.family && families.includes(r.family)) || r === byName)
  return {
    ext,
    claimed,
    detected,
    label:
      identified?.label ?? (ext ? `.${ext} file (bytes not checked)` : 'file (bytes not checked)'),
    families,
    rows: matched,
    mismatch: Boolean(identified?.strong && claimed && detected && claimed !== detected)
  }
}

// ── The inspector's result line ─────────────────────────────────────────────────────────────────

/** One finding from aegis_inspect.py. */
export interface InspectorFinding {
  code: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  kind: 'malware' | 'vulnerability'
  title: string
  detail: string
  line: number | null
  evidence: string | null
  hard: boolean
}

export interface InspectorResult {
  check: string
  findings: InspectorFinding[]
  facts: Record<string, string>
  extra: Record<string, unknown>
}

const RESULT_PREFIX = 'AEGIS_RESULT '
const SEVERITIES = ['low', 'medium', 'high', 'critical']

/** The tool output Droid sees: the inspector's machine-readable line removed. */
export function withoutResultLine(output: string): string {
  return output
    .split('\n')
    .filter((l) => !l.startsWith(RESULT_PREFIX))
    .join('\n')
}

/**
 * The inspector's result from a tool's full output, or null. Only the last line counts, and only
 * well-formed findings survive: everything the inspector prints about the sample is JSON-escaped,
 * so the sample can't forge this line, but it is checked anyway.
 */
export function parseInspectorResult(output: string): InspectorResult | null {
  const last = output.trimEnd().split('\n').pop() ?? ''
  if (!last.startsWith(RESULT_PREFIX)) return null
  try {
    const raw = JSON.parse(last.slice(RESULT_PREFIX.length)) as Partial<InspectorResult>
    const findings = (Array.isArray(raw.findings) ? raw.findings : []).filter(
      (f): f is InspectorFinding =>
        typeof f?.code === 'string' &&
        typeof f.title === 'string' &&
        SEVERITIES.includes(f.severity) &&
        (f.kind === 'malware' || f.kind === 'vulnerability')
    )
    return {
      check: String(raw.check ?? ''),
      findings: findings.map((f) => ({
        ...f,
        detail: typeof f.detail === 'string' ? f.detail : '',
        line: Number.isInteger(f.line) ? f.line : null,
        evidence: typeof f.evidence === 'string' ? f.evidence : null,
        hard: f.hard === true
      })),
      facts: raw.facts && typeof raw.facts === 'object' ? raw.facts : {},
      extra: raw.extra && typeof raw.extra === 'object' ? raw.extra : {}
    }
  } catch {
    return null
  }
}

/** The `identify` check's verdict on the bytes, from its result. */
export function identifiedFrom(result: InspectorResult | null): Identified | null {
  if (!result || result.check !== 'identify') return null
  const e = result.extra
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    family: str(e.family),
    claimedFamily: str(e.claimedFamily),
    label: str(e.label) ?? 'unknown',
    strong: e.strong === true
  }
}
