import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseEvalResults } from './evals'

const sample = {
  sample: 'zip-bomb',
  expected: 'malicious',
  got: 'suspicious',
  analyst: 'rules',
  scores: { 'aegis-verdict-match': 0.5, 'aegis-found-planted': 1 },
  error: null
}
const run = {
  evaluation: 'worker-b rules',
  run_id: 'r1',
  status: 'EvaluationRunStatus.SUCCEEDED',
  rows: 1,
  row_errors: 0,
  means: { 'aegis-verdict-match': 0.5, 'aegis-found-planted': 1 },
  per_sample: [sample]
}
const parse = (v: unknown): ReturnType<typeof parseEvalResults> =>
  parseEvalResults(JSON.stringify(v))

describe('parseEvalResults', () => {
  it('reads the committed evals/results.json (Chalk Evaluations: rules and agent)', () => {
    const r = parseEvalResults(readFileSync(resolve('evals/results.json'), 'utf8'))
    if ('error' in r) throw new Error(r.error)
    expect(r.worker_b.map((x) => x.evaluation)).toEqual(['worker-b rules', 'worker-b agent'])
    for (const x of r.worker_b) {
      expect(x.rows).toBe(x.per_sample.length)
      expect(Object.keys(x.means)).toContain('aegis-verdict-match')
    }
  })

  it('accepts a well-formed file', () => {
    const r = parse({ generated_at: '2026-10-18T05:40:45Z', worker_b: [run] })
    expect(r).toEqual({ generated_at: '2026-10-18T05:40:45Z', worker_b: [run] })
  })

  it('fills optional fields a run or sample leaves out, and keeps null scores as null', () => {
    const r = parse({
      generated_at: 'x',
      worker_b: [
        {
          evaluation: 'worker-b agent',
          means: { 'aegis-verdict-match': null },
          per_sample: [{ sample: 's', expected: 'clean' }]
        }
      ]
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.worker_b[0]).toMatchObject({ run_id: '', status: '', rows: 0, row_errors: 0 })
    expect(r.worker_b[0].means['aegis-verdict-match']).toBeNull()
    expect(r.worker_b[0].per_sample[0]).toEqual({
      sample: 's',
      expected: 'clean',
      got: null,
      analyst: null,
      scores: {},
      error: null
    })
  })

  it('returns an error, never throws, for the old shape (the Accuracy screen crash)', () => {
    const r = parse({ ranAt: 'x', configurations: [] })
    expect(r).toEqual({ error: expect.stringContaining('generated_at') })
  })

  it('returns an error for malformed fields', () => {
    expect(parse({ generated_at: 'x', worker_b: [{ ...run, means: 'high' }] })).toEqual({
      error: expect.stringContaining('worker_b.0.means')
    })
    expect(parse({ generated_at: 'x', worker_b: [{ ...run, rows: -1 }] })).toHaveProperty('error')
    expect(parse({ generated_at: 'x', worker_b: null })).toHaveProperty('error')
    expect(parse(null)).toHaveProperty('error')
    expect(parse([])).toHaveProperty('error')
  })

  it('returns an error for text that is not JSON', () => {
    expect(parseEvalResults('{ not json')).toEqual({
      error: expect.stringContaining('not JSON')
    })
    expect(parseEvalResults('')).toHaveProperty('error')
  })
})
