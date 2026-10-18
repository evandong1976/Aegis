// evals/results.json, as written by chalk/aegis_worker_b/evals.py (Chalk Evaluations): one run per
// Worker B configuration (playbook rules alone, then the full agent) on the same labeled samples.
// The main process parses it with this schema before it reaches the Accuracy screen.

import { z } from 'zod'

/** Python writes None for a score a scorer didn't return; keep those as null, never as 0. */
const ScoresSchema = z.record(z.string(), z.number().nullable())

export const EvalSampleSchema = z.object({
  sample: z.string(),
  /** Labeled verdict: clean · unknown · suspicious · malicious. */
  expected: z.string(),
  /** Worker B's verdict; null when its output didn't parse. */
  got: z.string().nullable().default(null),
  analyst: z.string().nullable().default(null),
  scores: ScoresSchema.default({}),
  error: z.string().nullable().default(null)
})
export type EvalSample = z.infer<typeof EvalSampleSchema>

export const EvalRunSchema = z.object({
  /** "worker-b rules" or "worker-b agent". */
  evaluation: z.string(),
  run_id: z.string().default(''),
  /** e.g. "EvaluationRunStatus.SUCCEEDED". */
  status: z.string().default(''),
  rows: z.number().int().nonnegative().default(0),
  row_errors: z.number().int().nonnegative().default(0),
  /** Mean of each scorer over all rows, 0–1. */
  means: ScoresSchema,
  per_sample: z.array(EvalSampleSchema).default([])
})
export type EvalRun = z.infer<typeof EvalRunSchema>

export const EvalResultsSchema = z.object({
  generated_at: z.string(),
  worker_b: z.array(EvalRunSchema)
})
export type EvalResults = z.infer<typeof EvalResultsSchema>

/** What `evals:get` returns: null when there's no results file, `{ error }` when it's unreadable. */
export type EvalResultsReply = EvalResults | { error: string } | null

/** Parses the text of evals/results.json. Never throws. */
export function parseEvalResults(raw: string): Exclude<EvalResultsReply, null> {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { error: `evals/results.json is not JSON: ${(e as Error).message}` }
  }
  const parsed = EvalResultsSchema.safeParse(json)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const at = issue.path.length ? issue.path.join('.') : 'the top level'
  return {
    error: `evals/results.json is not in the Chalk Evaluations format (${at}: ${issue.message}).`
  }
}
