import type { EvalRun } from '@shared/ipc'
import { Card, EmptyState, Meter, ThreatTable } from '../../components/ds'
import { VerdictBadge } from '../../components/aegis'
import { useInvoke } from '../../lib/hooks'

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`

// The scorers in chalk/aegis_worker_b/scoring.py, in the order they are shown.
const SCORERS: Array<[key: string, label: string]> = [
  ['aegis-verdict-match', 'Verdict match'],
  ['aegis-found-planted', 'Found the planted issue'],
  ['aegis-evidence-verified', 'Evidence verified'],
  ['aegis-valid-json', 'Valid output']
]

// "worker-b agent" → "Agent"
const runLabel = (r: EvalRun): string => {
  const name = r.name.replace(/^worker-b\s+/i, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Reads evals/results.json, written by Worker B's Chalk Evaluations (chalk/aegis_worker_b/evals.py).
// Only numbers from a real eval run are shown; there is no sample data here, in demo mode either.
export default function AccuracyView(): React.JSX.Element {
  const { data: results } = useInvoke('evals:get')

  if (!results || results.runs.length === 0) {
    return (
      <Card
        title="Eval results"
        description="How often Worker B gets the verdict right on labeled files, measured with Chalk Evaluations."
      >
        <EmptyState
          icon="chart-column"
          title="No eval run yet"
          description="Run cd chalk && uv run --env-file ../.env.local python -m aegis_worker_b.evals to score Worker B's rules alone and with the agent on the labeled samples. Results appear here with the run date and sample count."
        />
      </Card>
    )
  }

  const runs = results.runs
  const samples = runs[0].samples.map((s) => s.sample)
  const gotBy = runs.map((r) => new Map(r.samples.map((s) => [s.sample, s])))

  return (
    <>
      <p className="mono-sm m-0 text-ink-subtle">
        Run {new Date(results.ranAt).toLocaleString()} ·{' '}
        {runs
          .map((r) => `${runLabel(r)}: ${r.rows} samples, ${r.status.toLowerCase()}`)
          .join(' · ')}
      </p>
      <div className="grid grid-cols-2 gap-5">
        {runs.map((r, i) => (
          <Card
            key={r.runId}
            title={runLabel(r)}
            description={
              r.rowErrors > 0
                ? `${r.rowErrors} of ${r.rows} samples errored`
                : `${r.rows} samples, no errors`
            }
            highlight={i === runs.length - 1}
          >
            <div className="flex flex-col gap-4">
              {SCORERS.filter(([key]) => key in r.means).map(([key, label]) => (
                <Meter
                  key={key}
                  label={label}
                  value={r.means[key] * 100}
                  display={pct(r.means[key])}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card
        title="Sample by sample"
        description="The labeled verdict next to what each run returned."
      >
        <ThreatTable
          columns={[
            { key: 'sample', header: 'Sample', mono: true, nowrap: true },
            { key: 'expected', header: 'Expected' },
            ...runs.map((r) => ({ key: r.runId, header: runLabel(r) }))
          ]}
          rows={samples.map((name) => ({
            sample: name,
            expected: (
              <VerdictBadge verdict={runs[0].samples.find((s) => s.sample === name)!.expected} />
            ),
            ...Object.fromEntries(
              runs.map((r, i) => {
                const s = gotBy[i].get(name)
                return [
                  r.runId,
                  s?.got ? (
                    <span className="flex items-center gap-2">
                      <VerdictBadge verdict={s.got} />
                      {s.got !== s.expected && (
                        <span className="mono-sm text-ink-subtle">miss</span>
                      )}
                    </span>
                  ) : (
                    '—'
                  )
                ]
              })
            )
          }))}
        />
      </Card>
    </>
  )
}
