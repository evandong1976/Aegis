// Core domain types: verdicts, findings, scans, reports, health.
// Both people import from here; change only together and note it in the Handoff.

import { z } from 'zod'
import type { SERVICE_NAMES } from './constants'

/**
 * The four verdicts (design-system/README.md). Labels and badge levels live in `verdicts.ts`.
 * - clean: delivered. Copy in sentences is "No threats found"; never "safe".
 * - unknown: allowed or held but flagged — Aegis could not reach a confident verdict
 *   (partial analysis, sandbox unavailable, a brand-new domain with no other signal).
 * - suspicious: held, waiting on the user.
 * - malicious: blocked or quarantined outright.
 */
export const VerdictSchema = z.enum(['clean', 'unknown', 'suspicious', 'malicious'])
export type Verdict = z.infer<typeof VerdictSchema>

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type Severity = z.infer<typeof SeveritySchema>

export const EvidenceSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().optional(),
  code: z.string()
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const FindingSchema = z.object({
  severity: SeveritySchema,
  title: z.string(),
  detail: z.string(),
  evidence: EvidenceSchema.optional()
})
export type Finding = z.infer<typeof FindingSchema>

/** One reason behind a score, shown to the user. */
export const ReasonSchema = z.object({
  /** Stable machine key, e.g. `lookalike_brand`. */
  code: z.string(),
  /** Plain English, short: "registered 2 days ago". */
  text: z.string(),
  /** Points this reason added to the score. */
  weight: z.number(),
  /** Hard rules make the verdict malicious regardless of score. */
  hard: z.boolean().default(false)
})
export type Reason = z.infer<typeof ReasonSchema>

export const CheckStateSchema = z.enum(['ok', 'timeout', 'skipped', 'error'])
export type CheckState = z.infer<typeof CheckStateSchema>

export const LinkVerdictSchema = z.object({
  url: z.string(),
  /** The URL with secret-looking query params removed (MEGA_PROMPT §6 rule 9). */
  urlStripped: z.string(),
  domain: z.string(),
  verdict: VerdictSchema,
  score: z.number().min(0).max(100),
  reasons: z.array(ReasonSchema),
  trusted: z.boolean(),
  /** Which checks ran; reports show what timed out. */
  checks: z.record(z.string(), CheckStateSchema),
  /** How long the app took to reach this verdict. */
  checkedMs: z.number().nonnegative().optional()
})
export type LinkVerdict = z.infer<typeof LinkVerdictSchema>

export const ScamTextResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: VerdictSchema,
  scamType: z.string().nullable(),
  /** The exact sentences that triggered it. The page text itself is never stored. */
  sentences: z.array(z.string())
})
export type ScamTextResult = z.infer<typeof ScamTextResultSchema>

export const ScanKindSchema = z.enum(['download', 'quarantine', 'link', 'message'])
export type ScanKind = z.infer<typeof ScanKindSchema>

export const ScanSourceSchema = z.enum(['chrome', 'watcher', 'photon'])
export type ScanSource = z.infer<typeof ScanSourceSchema>

export const ScanStatusSchema = z.enum([
  'received',
  'prechecked',
  'uploaded',
  'analyzing',
  'verdict',
  'reviewing',
  'done',
  'failed'
])
export type ScanStatus = z.infer<typeof ScanStatusSchema>

/** What happened to the thing: the "Action" column. */
export const ScanActionSchema = z.enum([
  'scanning',
  'delivered',
  'allowed',
  'held',
  'quarantined',
  'blocked',
  'deleted',
  'restored'
])
export type ScanAction = z.infer<typeof ScanActionSchema>

/** `analyze.py` output (MEGA_PROMPT §5.3). */
export const Stage1ResultSchema = z.object({
  file: z.object({
    name: z.string(),
    realType: z.string(),
    sha256: z.string(),
    size: z.number(),
    entropy: z.number().optional()
  }),
  findings: z.array(FindingSchema),
  iocs: z.array(z.string()),
  capabilities: z.array(z.string()),
  disassembly: z.string().optional(),
  score: z.number().min(0).max(100),
  partial: z.boolean()
})
export type Stage1Result = z.infer<typeof Stage1ResultSchema>

/** One step of "What would have happened". Danger = harmful act, warning = suspicious act. */
export const TimelineStepSchema = z.object({
  step: z.number().int().positive(),
  tone: z.enum(['danger', 'warning']),
  title: z.string(),
  detail: z.string(),
  evidence: z.array(EvidenceSchema)
})
export type TimelineStep = z.infer<typeof TimelineStepSchema>

/** Droid's Stage 2 report (MEGA_PROMPT §5.4). Validated in `droid.ts`. */
export const DroidReportSchema = z.object({
  timeline: z.array(TimelineStepSchema),
  verdict: VerdictSchema,
  /** One sentence, for the report headline, notifications and texts. */
  summary: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  unknowns: z.array(z.string())
})
export type DroidReport = z.infer<typeof DroidReportSchema>

/** A run of source lines shown as code evidence, with the dangerous lines flagged. */
export const CodeExcerptSchema = z.object({
  path: z.string(),
  /** Where the file came from, e.g. "extracted in the sandbox". */
  origin: z.string(),
  startLine: z.number().int().positive(),
  lines: z.array(z.string()),
  flags: z.array(
    z.object({ line: z.number().int().positive(), title: z.string(), severity: SeveritySchema })
  )
})
export type CodeExcerpt = z.infer<typeof CodeExcerptSchema>

export const SandboxRecordSchema = z.object({
  provider: z.enum(['daytona', 'docker']),
  sandboxId: z.string(),
  image: z.string(),
  network: z.enum(['off', 'on']),
  startupMs: z.number(),
  runMs: z.number(),
  ran: z.array(z.string()),
  destroyedAt: z.string().nullable()
})
export type SandboxRecord = z.infer<typeof SandboxRecordSchema>

/** "Checks that ran" in a report: which step ran and how it ended. */
export const CheckRunSchema = z.object({
  name: z.string(),
  state: z.enum(['ok', 'warn', 'fail', 'skipped']),
  /** Short result, set in mono: "passed", "38 s", "no match", "timed out". */
  result: z.string()
})
export type CheckRun = z.infer<typeof CheckRunSchema>

export const IndicatorsSchema = z.object({
  sha256: z.string().nullable(),
  realType: z.string().nullable(),
  claimedType: z.string().nullable(),
  signature: z.string().nullable(),
  size: z.number().nullable(),
  firstSeen: z.string().nullable()
})
export type Indicators = z.infer<typeof IndicatorsSchema>

export interface ScanSummary {
  id: string
  kind: ScanKind
  source: ScanSource
  /** Where it was seen, for people: "Chrome", "~/Downloads", "iMessage". */
  seenIn: string
  url: string | null
  filename: string | null
  /** Plain-English file kind: "Disc image", "Installer". */
  fileKind: string | null
  size: number | null
  status: ScanStatus
  verdict: Verdict | null
  score: number | null
  /** The top reason, short: "Brand impersonation". */
  reason: string | null
  action: ScanAction
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

export interface ScanReport extends ScanSummary {
  /** One-sentence headline; Droid's summary when it ran. */
  summary: string | null
  reasons: Reason[]
  stage1: Stage1Result | null
  droid: DroidReport | null
  indicators: Indicators
  code: CodeExcerpt[]
  checks: CheckRun[]
  sandbox: SandboxRecord[]
  partial: boolean
  heldPath: string | null
}

export type ServiceKey = keyof typeof SERVICE_NAMES

/**
 * ok: working. degraded: partly working. down: failing.
 * unconfigured: no key / not set up yet. pending: not checked yet.
 */
export type ServiceState = 'ok' | 'degraded' | 'down' | 'unconfigured' | 'pending'

export interface ServiceHealth {
  key: ServiceKey
  name: string
  state: ServiceState
  /** One line: what is true, then what to do. */
  detail: string
  /** Required services put the tray into "degraded" when not ok. */
  required: boolean
  checkedAt: string | null
  latencyMs?: number
}

export type ProtectionState = 'protected' | 'scanning' | 'degraded' | 'blocked' | 'paused'

export interface AppStatus {
  protection: ProtectionState
  pausedUntil: string | null
  mode: 'block' | 'warn'
  health: ServiceHealth[]
  activeScans: number
  extensionLastSeen: string | null
  /** True when the app runs on the demo database (AEGIS_DEMO=1). */
  demo: boolean
  /** The open Chrome tab's link counts, from the extension (milestone 2). */
  page: PageSnapshot | null
}

export interface PageSnapshot {
  url: string
  counts: Record<Verdict, number>
  /** The riskiest link on the page, named in the panel. */
  top: { domain: string; reason: string; verdict: Verdict } | null
}

/** A raw line for the scan log, as the scanners report it. */
export interface LogEntry {
  at: string
  level: 'block' | 'warn' | 'allow' | null
  text: string
}
