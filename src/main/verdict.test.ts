import { describe, expect, it } from 'vitest'
import type { Reason } from '@shared/types'
import { VERDICT_SENTENCE, VERDICTS } from '@shared/verdicts'
import { applyAiSuggestion, combine, verdictFromScore } from './verdict'

const r = (weight: number, hard = false): Reason => ({ code: 'test', text: 'test', weight, hard })

describe('verdictFromScore', () => {
  it('uses the 0–29 / 30–69 / 70–100 bands', () => {
    expect(verdictFromScore(0)).toBe('clean')
    expect(verdictFromScore(29)).toBe('clean')
    expect(verdictFromScore(30)).toBe('suspicious')
    expect(verdictFromScore(69)).toBe('suspicious')
    expect(verdictFromScore(70)).toBe('malicious')
    expect(verdictFromScore(100)).toBe('malicious')
  })
})

describe('combine', () => {
  it('sums weights and caps at 100', () => {
    expect(combine([r(20), r(15)])).toMatchObject({ verdict: 'suspicious', score: 35 })
    expect(combine([r(80), r(80)]).score).toBe(100)
  })

  it('ignores negative weights', () => {
    expect(combine([r(40), r(-40)])).toMatchObject({ verdict: 'suspicious', score: 40 })
  })

  it('a hard rule makes it malicious regardless of score', () => {
    expect(combine([r(5, true)])).toMatchObject({ verdict: 'malicious', score: 70 })
  })

  it('incomplete evidence turns clean into unknown, never into clean', () => {
    expect(combine([r(10)], { confident: false }).verdict).toBe('unknown')
    expect(combine([r(40)], { confident: false }).verdict).toBe('suspicious')
  })
})

describe('AI can only raise', () => {
  it('raises clean → unknown → suspicious → malicious', () => {
    const clean = combine([])
    expect(applyAiSuggestion(clean, 'unknown').verdict).toBe('unknown')
    expect(applyAiSuggestion(clean, 'suspicious')).toMatchObject({
      verdict: 'suspicious',
      score: 30
    })
    const suspicious = combine([r(40)])
    expect(applyAiSuggestion(suspicious, 'malicious')).toMatchObject({
      verdict: 'malicious',
      score: 70
    })
  })

  it('never lowers a verdict', () => {
    const malicious = combine([r(5, true)])
    for (const v of ['clean', 'unknown', 'suspicious'] as const) {
      expect(applyAiSuggestion(malicious, v)).toBe(malicious)
    }
    const unknown = combine([], { confident: false })
    expect(applyAiSuggestion(unknown, 'clean')).toBe(unknown)
  })
})

describe('wording', () => {
  it('uses the four design-system words and never says "safe"', () => {
    expect(Object.values(VERDICTS).map((v) => v.label)).toEqual([
      'Clean',
      'Unknown',
      'Suspicious',
      'Malicious'
    ])
    for (const s of Object.values(VERDICT_SENTENCE)) expect(s.toLowerCase()).not.toContain('safe')
  })
})
