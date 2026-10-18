// Worker B (MEGA_PROMPT §5.3, §5.6; PLAN.md decision 32): the same file, examined by a GPT model
// through Chalk's Model Gateway, using the playbook in docs/file_types_vulnerabilities.md, with the
// tools running in a network-off Chalk sandbox. Its SHA-256 is first looked up in the known-malware
// feed kept in Chalk (a federated Chalk SQL query); a match is a hard rule. The Chalk side is Python (chalk/aegis_worker_b):
// this module hands it the bytes on stdin and reads one JSON result back.
//
// Two ways to reach it (AEGIS_WORKER_B_VIA):
// - `function` : call the deployed Chalk Function, so the agent code runs on Chalk Compute.
// - `local`    : run the same orchestrator on this Mac; the sample still goes only to Chalk's
//                sandbox and the model is still reached through the Model Gateway.
// Either way nothing from the sample runs on this Mac.

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { CheckRun, CodeExcerpt, Reason, SandboxRecord, Verdict } from '@shared/types'

export const WORKER_B_TIMEOUT_MS = 180_000

const VulnSchema = z.object({
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  tool: z.string(),
  location: z.string(),
  evidence: z.string(),
  explanation: z.string(),
  verified: z.boolean().default(false)
})

const LogSchema = z.object({
  at: z.string(),
  step: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  detail: z.string().default('')
})

const KnownBadSchema = z.object({
  matched: z.boolean().optional(),
  matches: z
    .array(
      z.object({ sha256: z.string(), signature: z.string(), source: z.string() }).passthrough()
    )
    .default([]),
  source: z.string().optional(),
  error: z.string().optional()
})

export const WorkerBResultSchema = z.object({
  worker: z.literal('B'),
  provider: z.literal('chalk'),
  sha256: z.string(),
  sandbox_id: z.string().optional(),
  error: z.string().optional(),
  analyst_error: z.string().optional(),
  known_bad: KnownBadSchema.optional(),
  ms: z.number(),
  sandbox_log: z.array(LogSchema).default([]),
  analysis: z
    .object({
      verdict: z.enum(['clean', 'suspicious', 'malicious', 'unknown']),
      confidence: z.enum(['low', 'medium', 'high']),
      summary: z.string(),
      file_type: z.string().default(''),
      playbook_rows: z.array(z.string()).default([]),
      vulnerabilities: z.array(VulnSchema).default([]),
      unknowns: z.array(z.string()).default([]),
      tool_log: z.array(z.record(z.string(), z.unknown())).default([]),
      model: z.string().default(''),
      turns: z.number().default(0),
      stop: z.string().default(''),
      analyst: z.enum(['agent', 'rules'])
    })
    .optional()
})
export type WorkerBResult = z.infer<typeof WorkerBResultSchema>

export interface WorkerBOptions {
  /** The repo root in dev (chalk/ lives under it). */
  root: string
  via?: 'function' | 'local'
  timeoutMs?: number
  /** Progress lines from the worker, for the scan log. */
  onLine?: (line: string) => void
  /** Injected in tests. */
  spawnWorker?: (input: string) => Promise<{ code: number | null; stdout: string; stderr: string }>
}

/** True when the Chalk credentials Worker B needs are set. */
export function workerBConfigured(env = process.env): boolean {
  return ['CHALK_CLIENT_ID', 'CHALK_CLIENT_SECRET', 'CHALK_ENVIRONMENT'].every(
    (k) => (env[k] ?? '').trim() !== ''
  )
}

function python(root: string): { cmd: string; args: string[] } {
  const venv = join(root, 'chalk', '.venv', 'bin', 'python')
  if (existsSync(venv)) return { cmd: venv, args: ['-m', 'aegis_worker_b.worker'] }
  return {
    cmd: 'uv',
    args: ['run', '--project', join(root, 'chalk'), 'python', '-m', 'aegis_worker_b.worker']
  }
}

function defaultSpawn(opts: WorkerBOptions) {
  return (input: string): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      const { cmd, args } = python(opts.root)
      const child = spawn(cmd, args, { cwd: join(opts.root, 'chalk'), env: process.env })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? WORKER_B_TIMEOUT_MS)
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString()
        for (const line of d.toString().split('\n')) if (line.trim()) opts.onLine?.(line.trim())
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
      child.stdin.end(input)
    })
}

/** Sends one file to Worker B. Resolves with its result, or throws when it couldn't run. */
export async function runWorkerB(
  bytes: Buffer,
  meta: { filename: string; scanId: string },
  opts: WorkerBOptions
): Promise<WorkerBResult> {
  const input = JSON.stringify({
    filename: meta.filename,
    data_b64: bytes.toString('base64'),
    scan_id: meta.scanId,
    via: opts.via ?? (process.env.AEGIS_WORKER_B_VIA === 'function' ? 'function' : 'local')
  })
  const { code, stdout, stderr } = await (opts.spawnWorker ?? defaultSpawn(opts))(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(
      `Worker B printed no result (exit ${code}): ${stderr.trim().split('\n').pop() ?? ''}`
    )
  }
  return WorkerBResultSchema.parse(parsed)
}

// ── into the report ───────────────────────────────────────────────────────────────────────────

/** What Worker B adds to a scan report. Only verified findings become reasons and evidence. */
export function workerBReport(
  res: WorkerBResult,
  filename: string
): {
  verdict: Verdict | null
  summary: string | null
  reasons: Reason[]
  code: CodeExcerpt[]
  checks: CheckRun[]
  sandbox: SandboxRecord | null
  /** True when an analyst (not just the rules) examined the file. */
  analysed: boolean
} {
  const a = res.analysis
  const create = res.sandbox_log.find((e) => e.step.startsWith('create'))
  const probe = res.sandbox_log.find((e) => e.step.startsWith('network probe'))
  const end = res.sandbox_log.find((e) => e.step === 'terminate')
  const checks: CheckRun[] = [
    res.error && !a
      ? { name: 'Chalk sandbox (Worker B)', state: 'fail', result: res.error.slice(0, 80) }
      : {
          name: 'Chalk sandbox (Worker B)',
          state: probe?.ok ? 'ok' : 'fail',
          result: probe?.ok
            ? `network off, proven · ${(res.ms / 1000).toFixed(0)} s`
            : 'network not proven off'
        }
  ]
  if (a) {
    checks.push({
      name: a.analyst === 'agent' ? 'Worker B analyst (GPT via Chalk)' : 'Worker B (rules only)',
      state:
        a.verdict === 'malicious'
          ? 'fail'
          : a.verdict === 'suspicious' || a.verdict === 'unknown'
            ? 'warn'
            : 'ok',
      result: `${a.verdict}, ${a.tool_log.length} tools${a.analyst === 'rules' && res.analyst_error ? ', model unavailable' : ''}`
    })
  }
  // The federated lookup: a listed hash is a hard rule (MEGA_PROMPT §5.3, like a feed match on a link).
  const kb = res.known_bad
  const hit = kb?.matched ? kb.matches[0] : undefined
  if (kb) {
    checks.unshift({
      name: 'Known-malware lookup (Chalk SQL)',
      state: hit ? 'fail' : kb.error ? 'warn' : 'ok',
      result: hit ? `listed: ${hit.signature}`.slice(0, 80) : kb.error ? 'unavailable' : 'no match'
    })
  }
  const verified = (a?.vulnerabilities ?? []).filter((v) => v.verified && v.tool !== 'known_hashes')
  const reasons: Reason[] = verified.map((v) => ({
    code: `worker_b_${v.type
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 40)}`,
    text: `${v.type} (${v.location}): ${v.explanation}`.slice(0, 200),
    // Shown as reasons; the verdict itself rises through applyAiSuggestion (AI can only raise).
    weight: 0,
    hard: false
  }))
  if (hit) {
    reasons.unshift({
      code: 'known_bad_hash',
      text: `Known malware: this exact file is listed by ${hit.source} as ${hit.signature}`.slice(
        0,
        200
      ),
      weight: 100,
      hard: true
    })
  }
  const code: CodeExcerpt[] = verified
    .map((v) => ({ v, line: Number(/line (\d+)/i.exec(v.location)?.[1]) }))
    .filter(({ line }) => Number.isInteger(line) && line > 0)
    .slice(0, 6)
    .map(({ v, line }) => ({
      path: filename,
      origin: `Worker B · ${v.tool} in the Chalk sandbox`,
      startLine: line,
      lines: [v.evidence.slice(0, 240)],
      flags: [{ line, title: v.type, severity: v.severity }]
    }))
  const sandbox: SandboxRecord | null = res.sandbox_id
    ? {
        provider: 'chalk',
        sandboxId: res.sandbox_id,
        image: 'aegis worker B (playbook tools)',
        network: 'off',
        startupMs: create?.ms ?? 0,
        runMs: res.sandbox_log
          .filter((e) => !e.step.startsWith('create'))
          .reduce((s, e) => s + e.ms, 0),
        ran: res.sandbox_log.map(
          (e) =>
            `${e.ok ? 'ok' : 'failed'} · ${e.step}: ${e.detail} (${(e.ms / 1000).toFixed(1)} s)`
        ),
        destroyedAt: end?.ok ? end.at : null
      }
    : null
  const analysed = a?.analyst === 'agent' && a.verdict !== 'unknown'
  return {
    verdict: hit ? 'malicious' : a && a.verdict !== 'unknown' ? a.verdict : null,
    summary: a?.summary ?? null,
    reasons,
    code,
    checks,
    sandbox,
    analysed
  }
}
