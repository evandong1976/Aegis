// Downloads — "File verdicts" (figma/screens.md §3): four tiles, the downloaded-files queue, then
// which engine caught them beside a bar chart by file type.

import { useState } from 'react'
import type { FileTab, OverviewStats } from '@shared/ipc'
import { LIVE_SAMPLES, type LiveSampleKey } from '@shared/live'
import {
  Button,
  Card,
  EmptyState,
  Meter,
  SearchField,
  StatTile,
  Tabs,
  ThreatTable
} from '../../components/ds'
import { delta, number } from '../../lib/format'
import { useInvoke } from '../../lib/hooks'
import { exportCsv, FILE_COLUMNS, fileRow } from './tables'

const EMPTY: Record<FileTab, [string, string]> = {
  held: [
    'Nothing held',
    'Every file in this window came back clean. Held files wait here with Show report, Delete and Download anyway.'
  ],
  quarantined: [
    'Nothing in quarantine',
    'Malicious files are kept here, out of ~/Downloads, until you delete or restore them.'
  ],
  delivered: [
    'Nothing delivered yet',
    'Files with no threats found land in ~/Downloads as the exact bytes Aegis scanned.'
  ],
  all: [
    'No files scanned yet',
    'Downloads from Chrome and files other apps drop in ~/Downloads are scanned before you open them.'
  ]
}

/** Chart series in order (design-system: chart-1 is the hero series). */
const SERIES = ['chart-1', 'chart-4', 'chart-5', 'chart-2', 'chart-3']

export default function DownloadsView({
  stats,
  onOpen
}: {
  stats: OverviewStats | undefined
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<FileTab>('held')
  const [filter, setFilter] = useState('')
  const { data } = useInvoke('scans:list', { kind: 'file', tab, search: filter, limit: 200 })
  const rows = data ?? []
  const t = stats?.today
  const y = stats?.yesterday
  const counts = stats?.tabCounts.files
  const caught = stats?.caughtBy ?? []
  const byType = stats?.byType ?? []
  const caughtMax = Math.max(1, ...caught.map((c) => c.files))
  const typeMax = Math.max(1, ...byType.map((c) => c.files))
  const [starting, setStarting] = useState<LiveSampleKey | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Until milestone 3 intercepts downloads: a built-in harmless file through a real sandbox. The
  // main process opens the live view (the Report route) as soon as the scan exists.
  const testSandbox = async (sample: LiveSampleKey): Promise<void> => {
    setStarting(sample)
    setTestError(null)
    try {
      const res = await window.aegis.invoke('live:start', sample)
      if ('error' in res) setTestError(res.error)
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-5">
        <StatTile
          label="Files scanned"
          value={number(t?.filesScanned ?? 0)}
          icon="file-search"
          {...(t && y ? delta(t.filesScanned, y.filesScanned) : {})}
          intent="good"
          caption="vs. yesterday"
        />
        <StatTile
          label="Quarantined"
          value={number(counts?.quarantined ?? 0)}
          icon="lock"
          caption="malicious, kept out of ~/Downloads"
        />
        <StatTile
          label="Held"
          value={number(counts?.held ?? 0)}
          icon="x"
          caption="waiting on your decision"
        />
        <StatTile
          label="Sandboxed"
          value={number(t?.filesSandboxed ?? 0)}
          icon="scan"
          caption="opened in a Daytona sandbox today"
        />
      </div>

      <Card
        title="Test the sandbox"
        description="Until Chrome downloads are intercepted (milestone 3), send a harmless built-in file through a real network-off Daytona sandbox and watch it being opened and reviewed. Uses Daytona credits."
        action={
          <div className="flex gap-2">
            {(Object.keys(LIVE_SAMPLES) as LiveSampleKey[]).map((key, i) => (
              <Button
                key={key}
                variant={i === 0 ? 'primary' : 'secondary'}
                size="sm"
                icon="play"
                disabled={starting !== null}
                title={LIVE_SAMPLES[key].detail}
                onClick={() => void testSandbox(key)}
              >
                {starting === key ? 'Starting…' : LIVE_SAMPLES[key].label}
              </Button>
            ))}
          </div>
        }
      >
        {testError ? (
          <p className="m-0 text-[13px] leading-[19px] text-danger">{testError}</p>
        ) : (
          <p className="m-0 text-[13px] leading-[19px] text-ink-muted">
            {LIVE_SAMPLES['fake-installer'].label}: {LIVE_SAMPLES['fake-installer'].detail}{' '}
            {LIVE_SAMPLES['terminal-demo'].label}: {LIVE_SAMPLES['terminal-demo'].detail}
          </p>
        )}
      </Card>

      <Card
        title="Downloaded files"
        description="A quarantined file never reaches your Mac; its report says why."
        action={
          <Button
            variant="secondary"
            size="sm"
            icon="file-text"
            disabled={rows.length === 0}
            onClick={() => exportCsv('aegis-downloads', rows)}
          >
            Export
          </Button>
        }
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <Tabs<FileTab>
            items={[
              { value: 'held', label: 'Held', count: counts?.held || undefined },
              {
                value: 'quarantined',
                label: 'Quarantined',
                count: counts?.quarantined || undefined
              },
              { value: 'delivered', label: 'Delivered' },
              { value: 'all', label: 'All' }
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchField
            className="w-[280px]"
            placeholder="Filter by file or hash"
            aria-label="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {rows.length > 0 ? (
          <ThreatTable
            columns={FILE_COLUMNS}
            rows={rows.map(fileRow)}
            onRowClick={(i) => onOpen(rows[i].id)}
          />
        ) : (
          <EmptyState
            icon={tab === 'all' ? 'file-search' : 'shield-check'}
            title={filter ? 'No matches' : EMPTY[tab][0]}
            description={filter ? `No file in this list matches “${filter}”.` : EMPTY[tab][1]}
          />
        )}
      </Card>

      <div className="grid grid-cols-2 gap-5">
        <Card title="What caught them" description="Which check returned the verdict, today.">
          {caught.length > 0 ? (
            <div className="flex flex-col gap-4">
              {caught.map((c, i) => (
                <Meter
                  key={c.engine}
                  label={c.engine}
                  value={(c.files / caughtMax) * 100}
                  display={`${c.files} file${c.files === 1 ? '' : 's'}`}
                  tone={i === 0 ? 'danger' : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13px] leading-[19px] text-ink-muted">Nothing flagged today.</p>
          )}
        </Card>
        <Card title="By file type" description="Everything scanned today.">
          {byType.length > 0 ? (
            <div
              className="ae-bars"
              role="img"
              aria-label={byType.map((b) => `${b.category}: ${b.files}`).join(', ')}
            >
              {byType.map((b, i) => (
                <div key={b.category} className="ae-bars__col">
                  <p className="ae-bars__value">{b.files}</p>
                  <div className="ae-bars__track">
                    <div
                      className="ae-bars__bar"
                      style={{
                        height: `${(b.files / typeMax) * 100}%`,
                        background: `var(--${SERIES[i % SERIES.length]})`
                      }}
                    />
                  </div>
                  <p className="ae-bars__label">{b.category}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13px] leading-[19px] text-ink-muted">No files scanned today.</p>
          )}
        </Card>
      </div>
    </>
  )
}
