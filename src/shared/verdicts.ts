// The one place verdicts map to words and badge levels (design-system/README.md: "the mapping
// lives in one place"). The renderer, the extension and notifications all read from here.

import type { LinkVerdict, ScanAction, Verdict } from './types'

/** SeverityBadge levels from the design system. */
export type BadgeLevel = 'critical' | 'high' | 'medium' | 'low' | 'secure'

export const VERDICTS: Record<Verdict, { label: string; level: BadgeLevel; rank: number }> = {
  clean: { label: 'Clean', level: 'secure', rank: 0 },
  unknown: { label: 'Unknown', level: 'medium', rank: 1 },
  suspicious: { label: 'Suspicious', level: 'high', rank: 2 },
  malicious: { label: 'Malicious', level: 'critical', rank: 3 }
}

/** Order for sorting and for "AI can only raise": clean < unknown < suspicious < malicious. */
export const VERDICT_ORDER: Verdict[] = ['clean', 'unknown', 'suspicious', 'malicious']

/** Sentence-level copy. A clean result is "No threats found", never "safe". */
export const VERDICT_SENTENCE: Record<Verdict, string> = {
  clean: 'No threats found',
  unknown: 'Aegis could not reach a confident verdict',
  suspicious: 'This looks risky',
  malicious: 'This is dangerous'
}

export const ACTION_LABEL: Record<ScanAction, string> = {
  scanning: 'Scanning',
  delivered: 'Delivered',
  allowed: 'Allowed',
  held: 'Held',
  quarantined: 'Quarantined',
  blocked: 'Blocked',
  deleted: 'Deleted',
  restored: 'Restored'
}

/** The headline the click guard leads with, from the strongest reason. */
export function linkHeadline(v: LinkVerdict): string {
  const top = v.reasons[0]
  switch (top?.code) {
    case 'safe_browsing':
    case 'threat_feed':
      return 'This link is on a list of known dangerous sites.'
    case 'text_mismatch':
      return 'This link doesn’t go where it says it does.'
    case 'lookalike_brand':
    case 'mixed_scripts':
      return 'This link imitates a site you might trust.'
    case 'hidden_destination':
      return 'Aegis can’t see where this link goes.'
    case 'domain_age':
      return 'This site was registered only days ago.'
    default:
      return v.verdict === 'malicious' ? 'This link is dangerous.' : 'This link looks risky.'
  }
}
