// Row builders for the verdict tables (ThreatTable). Verdict first, then the URL or file, then
// why and where, then time on the right (ThreatTable README).

import type { ThreatColumn } from '../../components/ds'
import type { ScanSummary } from '@shared/types'
import { ACTION_LABEL, VERDICTS } from '@shared/verdicts'
import { ScanningBadge, VerdictBadge } from '../../components/aegis'
import { clock, displayUrl, size } from '../../lib/format'

export function verdictCell(s: ScanSummary): React.JSX.Element {
  return s.verdict ? <VerdictBadge verdict={s.verdict} /> : <ScanningBadge />
}

export const LINK_COLUMNS: ThreatColumn[] = [
  { key: 'verdict', header: 'Verdict' },
  { key: 'url', header: 'URL', mono: true },
  { key: 'reason', header: 'Reason' },
  { key: 'seenIn', header: 'Seen in', nowrap: true },
  { key: 'time', header: 'Scanned', mono: true },
  { key: 'action', header: 'Action', align: 'right', nowrap: true }
]

export const FILE_COLUMNS: ThreatColumn[] = [
  { key: 'verdict', header: 'Verdict' },
  { key: 'file', header: 'File', mono: true },
  { key: 'kind', header: 'Kind', nowrap: true },
  { key: 'size', header: 'Size', mono: true, align: 'right' },
  { key: 'seenIn', header: 'Seen in', nowrap: true },
  { key: 'time', header: 'Scanned', mono: true },
  { key: 'action', header: 'Action', align: 'right', nowrap: true }
]

export const MIXED_COLUMNS: ThreatColumn[] = [
  { key: 'verdict', header: 'Verdict' },
  { key: 'what', header: 'URL or file', mono: true },
  { key: 'seenIn', header: 'Seen in', nowrap: true },
  { key: 'time', header: 'Scanned', align: 'right', mono: true }
]

export function linkRow(s: ScanSummary): Record<string, React.ReactNode> {
  return {
    verdict: verdictCell(s),
    url: displayUrl(s.url),
    reason: s.reason ?? '—',
    seenIn: s.seenIn,
    time: clock(s.createdAt),
    action: ACTION_LABEL[s.action]
  }
}

export function fileRow(s: ScanSummary): Record<string, React.ReactNode> {
  return {
    verdict: verdictCell(s),
    file: s.filename ?? displayUrl(s.url),
    kind: s.fileKind ?? '—',
    size: size(s.size),
    seenIn: s.seenIn,
    time: clock(s.createdAt),
    action: s.action === 'scanning' ? 'Scanning…' : ACTION_LABEL[s.action]
  }
}

export function mixedRow(s: ScanSummary): Record<string, React.ReactNode> {
  return {
    verdict: verdictCell(s),
    what: s.kind === 'link' ? displayUrl(s.url) : (s.filename ?? displayUrl(s.url)),
    seenIn: s.seenIn,
    time: clock(s.createdAt)
  }
}

/** Saves the rows as CSV through the browser's download (no file access from the renderer). */
export function exportCsv(name: string, scans: ScanSummary[]): void {
  const header = [
    'verdict',
    'kind',
    'url',
    'file',
    'reason',
    'seen_in',
    'action',
    'size_bytes',
    'scanned_at'
  ]
  const quote = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = scans.map((s) =>
    [
      s.verdict ? VERDICTS[s.verdict].label : 'Scanning',
      s.kind,
      s.url,
      s.filename,
      s.reason,
      s.seenIn,
      ACTION_LABEL[s.action],
      s.size,
      s.createdAt
    ]
      .map(quote)
      .join(',')
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
