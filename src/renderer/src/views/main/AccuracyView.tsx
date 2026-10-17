import { Card, EmptyState, Meter, ThreatTable } from '../../components/ds'
import { useInvoke } from '../../lib/hooks'

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`

// Reads evals/results.json written by `pnpm eval` (Chalk Agent Evals, milestone 6).
// Only numbers from a real eval run are shown; there is no sample data here, in demo mode either.
export default function AccuracyView(): React.JSX.Element {
  const { data: results } = useInvoke('evals:get')

  if (!results) {
    return (
      <Card
        title="Eval results"
        description="Precision, recall and false alarms on labeled links, texts and files, measured with Chalk Agent Evals."
      >
        <EmptyState
          icon="chart-column"
          title="No eval run yet"
          description="Run pnpm eval to score rules alone, rules + Chalk, and rules + Chalk + LLM/Droid on the labeled sets in evals/. Results appear here with the run date and dataset sizes."
        />
      </Card>
    )
  }

  return (
    <>
      <p className="mono-sm m-0 text-ink-subtle">
        Run {new Date(results.ranAt).toLocaleString()} ·{' '}
        {Object.entries(results.datasets)
          .map(([name, d]) => `${name}: ${d.size}`)
          .join(' · ')}
      </p>
      <div className="grid grid-cols-3 gap-5">
        {results.configurations.map((c, i) => (
          <Card key={c.name} title={c.name} highlight={i === results.configurations.length - 1}>
            <div className="flex flex-col gap-4">
              <Meter label="Precision" value={c.precision * 100} display={pct(c.precision)} />
              <Meter label="Recall" value={c.recall * 100} display={pct(c.recall)} />
              <Meter
                label="False alarms"
                value={c.falseAlarmRate * 100}
                display={pct(c.falseAlarmRate)}
              />
            </div>
          </Card>
        ))}
      </div>
      <Card title="Side by side">
        <ThreatTable
          columns={[
            { key: 'name', header: 'Configuration' },
            { key: 'precision', header: 'Precision', mono: true, align: 'right' },
            { key: 'recall', header: 'Recall', mono: true, align: 'right' },
            { key: 'far', header: 'False-alarm rate', mono: true, align: 'right' },
            { key: 'ms', header: 'Time per verdict', mono: true, align: 'right' }
          ]}
          rows={results.configurations.map((c) => ({
            name: c.name,
            precision: pct(c.precision),
            recall: pct(c.recall),
            far: pct(c.falseAlarmRate),
            ms: `${Math.round(c.msPerVerdict)} ms`
          }))}
        />
      </Card>
    </>
  )
}
