import type { ReactNode } from 'react'
import type { EvalRun } from '@shared/evals'
import type { Verdict } from '@shared/types'
import { VERDICTS } from '@shared/verdicts'
import { VerdictBadge } from '../../components/aegis'
import { Card, EmptyState, Meter, ThreatTable } from '../../components/ds'
import { useInvoke } from '../../lib/hooks'

const pct = (n: number | null | undefined): string =>
  typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '—'

/** Display names for the scorers in chalk/aegis_worker_b/evals.py, in the order they're shown. */
const SCORERS: Record<string, string> = {
  'aegis-verdict-match': 'Verdict match',
  'aegis-found-planted': 'Found planted',
  'aegis-evidence-verified': 'Evidence verified',
  'aegis-valid-json': 'Valid JSON'
}

const GRID = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3']

/** Known scorers first, in SCORERS order, then any others the runs report. */
function scorerKeys(runs: EvalRun[]): string[] {
  const seen = new Set(runs.flatMap((r) => Object.keys(r.means)))
  return [
    ...Object.keys(SCORERS).filter((k) => seen.has(k)),
    ...[...seen].filter((k) => !Object.hasOwn(SCORERS, k))
  ]
}

/** "worker-b rules" → "Rules"; anything else is shown as written. */
function runName(run: EvalRun): string {
  const tail = run.evaluation.replace(/^worker-b\s+/i, '')
  return tail.charAt(0).toUpperCase() + tail.slice(1)
}

function verdict(word: string | null): ReactNode {
  if (word && Object.hasOwn(VERDICTS, word))
    return <VerdictBadge verdict={word as Verdict} subtle />
  return <span className="text-ink-subtle">{word ?? 'no verdict'}</span>
}

// Reads evals/results.json written by chalk/aegis_worker_b/evals.py (Chalk Evaluations), validated
// in the main process (src/shared/evals.ts). Only numbers from a real eval run are shown; there is
// no sample data here, in demo mode either.
export default function AccuracyView(): React.JSX.Element {
  const { data: results } = useInvoke('evals:get')

  if (!results || 'error' in results || results.worker_b.length === 0) {
    const error = results && 'error' in results ? results.error : null
    return (
      <Card
        title="Eval results"
        description="How often Worker B gets the labeled verdict, finds the planted vulnerability and backs it with evidence, measured with Chalk Evaluations."
      >
        <EmptyState
          icon="chart-column"
          title={error ? 'Eval results could not be read' : 'No eval run yet'}
          description={
            error ??
            'Run python -m aegis_worker_b.evals in chalk/ to score the playbook rules alone and the full Worker B agent on the labeled samples. Results appear here with the run date and sample count.'
          }
        />
      </Card>
    )
  }

  const runs = results.worker_b
  const keys = scorerKeys(runs)
  const label = (k: string): string => (Object.hasOwn(SCORERS, k) ? SCORERS[k] : k)
  const samples = [...new Set(runs.flatMap((r) => r.per_sample.map((s) => s.sample)))]
  const bySample = runs.map((r) => new Map(r.per_sample.map((s) => [s.sample, s])))

  return (
    <>
      <p className="mono-sm m-0 text-ink-subtle">
        Run {new Date(results.generated_at).toLocaleString()} · Chalk Evaluations ·{' '}
        {runs.map((r) => `${runName(r)}: ${r.rows} samples`).join(' · ')}
      </p>
      <div className={`grid ${GRID[Math.min(runs.length, 3)]} gap-5`}>
        {runs.map((r, i) => (
          <Card
            key={r.run_id || r.evaluation}
            title={runName(r)}
            description={`${r.status.replace(/^EvaluationRunStatus\./, '').toLowerCase() || 'unknown status'} · ${r.row_errors} row error${r.row_errors === 1 ? '' : 's'}`}
            highlight={i === runs.length - 1}
          >
            <div className="flex flex-col gap-4">
              {keys.map((k) => {
                const v = r.means[k]
                return (
                  <Meter
                    key={k}
                    label={label(k)}
                    value={typeof v === 'number' ? v * 100 : 0}
                    display={pct(v)}
                  />
                )
              })}
            </div>
          </Card>
        ))}
      </div>
      <Card title="Side by side">
        <ThreatTable
          columns={[
            { key: 'score', header: 'Score' },
            ...runs.map((r, i) => ({
              key: `r${i}`,
              header: runName(r),
              mono: true,
              align: 'right' as const
            }))
          ]}
          rows={keys.map((k) => ({
            score: label(k),
            ...Object.fromEntries(runs.map((r, i) => [`r${i}`, pct(r.means[k])]))
          }))}
        />
      </Card>
      {samples.length > 0 ? (
        <Card title="Per sample" description="The labeled verdict, and what each run returned.">
          <ThreatTable
            columns={[
              { key: 'sample', header: 'Sample', mono: true, nowrap: true },
              { key: 'expected', header: 'Expected' },
              ...runs.map((r, i) => ({ key: `r${i}`, header: runName(r) }))
            ]}
            rows={samples.map((name) => {
              const first = bySample.find((m) => m.has(name))?.get(name)
              return {
                sample: name,
                expected: verdict(first?.expected ?? null),
                ...Object.fromEntries(
                  bySample.map((m, i) => {
                    const s = m.get(name)
                    return [`r${i}`, s ? (s.error ? `error: ${s.error}` : verdict(s.got)) : '—']
                  })
                )
              }
            })}
          />
        </Card>
      ) : null}
    </>
  )
}
