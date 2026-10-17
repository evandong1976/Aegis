// Every verdict in Aegis goes through here (BUILD_PROMPT §2).
// Score bands: 0–29 clean, 30–69 suspicious, 70–100 malicious. Hard rules make it malicious
// regardless of score. Unknown means Aegis could not reach a confident verdict.
// AI can only raise a verdict, never lower it (order: clean < unknown < suspicious < malicious).

import { VERDICT_THRESHOLDS } from '@shared/constants'
import type { Reason, Verdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'

export function verdictFromScore(score: number): Verdict {
  if (score >= VERDICT_THRESHOLDS.malicious) return 'malicious'
  if (score >= VERDICT_THRESHOLDS.suspicious) return 'suspicious'
  return 'clean'
}

export function maxVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICTS[a].rank >= VERDICTS[b].rank ? a : b
}

export interface RuleVerdict {
  verdict: Verdict
  score: number
  reasons: Reason[]
}

export interface CombineOptions {
  /**
   * False when the evidence is incomplete: analysis partial or timed out, sandbox unavailable,
   * or a link with no data beyond a brand-new domain. A would-be clean result becomes unknown.
   */
  confident?: boolean
}

/** Combines rule, feature and analysis reasons into a score and verdict. */
export function combine(reasons: Reason[], { confident = true }: CombineOptions = {}): RuleVerdict {
  const raw = reasons.reduce((sum, r) => sum + Math.max(0, r.weight), 0)
  let score = Math.min(100, Math.round(raw))
  const hard = reasons.some((r) => r.hard)
  if (hard) score = Math.max(score, VERDICT_THRESHOLDS.malicious)
  let verdict: Verdict = hard ? 'malicious' : verdictFromScore(score)
  if (verdict === 'clean' && !confident) verdict = 'unknown'
  return { verdict, score, reasons }
}

/**
 * Applies a verdict suggested by an AI (Droid or the scam-text LLM).
 * The result is never lower than `current`: a sample saying "this file is safe" changes nothing.
 */
export function applyAiSuggestion(
  current: RuleVerdict,
  suggested: Verdict,
  reason?: Reason
): RuleVerdict {
  const verdict = maxVerdict(current.verdict, suggested)
  if (verdict === current.verdict) return current
  const floor =
    verdict === 'malicious'
      ? VERDICT_THRESHOLDS.malicious
      : verdict === 'suspicious'
        ? VERDICT_THRESHOLDS.suspicious
        : current.score
  return {
    verdict,
    score: Math.max(current.score, floor),
    reasons: reason ? [...current.reasons, reason] : current.reasons
  }
}
