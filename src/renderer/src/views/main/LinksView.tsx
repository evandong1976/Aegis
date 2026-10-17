// Links — "URL verdicts" (figma/screens.md §2): four tiles, then the clicked-links queue with
// tabs, a filter and the verdict table.

import { useState } from 'react'
import type { LinkTab, OverviewStats } from '@shared/ipc'
import {
  Button,
  Card,
  EmptyState,
  SearchField,
  StatTile,
  Tabs,
  ThreatTable
} from '../../components/ds'
import { delta, number } from '../../lib/format'
import { useInvoke } from '../../lib/hooks'
import { exportCsv, LINK_COLUMNS, linkRow } from './tables'

const EMPTY: Record<LinkTab, [string, string]> = {
  held: [
    'Nothing held',
    'Every link you clicked came back with a verdict you didn’t need to review. Held links wait here until you decide.'
  ],
  blocked: [
    'Nothing blocked',
    'No link you clicked was malicious. Blocked links stay listed here with their report.'
  ],
  allowed: [
    'No allowed links yet',
    'Links that came back clean or unknown and opened normally show up here.'
  ],
  all: [
    'No links checked yet',
    'Once the Chrome extension is connected, every link you click gets a verdict in about a second.'
  ]
}

export default function LinksView({
  stats,
  onOpen
}: {
  stats: OverviewStats | undefined
  onOpen: (id: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<LinkTab>('held')
  const [filter, setFilter] = useState('')
  const { data } = useInvoke('scans:list', { kind: 'link', tab, search: filter, limit: 200 })
  const rows = data ?? []
  const t = stats?.today
  const y = stats?.yesterday
  const counts = stats?.tabCounts.links

  return (
    <>
      <div className="grid grid-cols-4 gap-5">
        <StatTile
          label="Checked today"
          value={number(t?.linksChecked ?? 0)}
          icon="globe"
          {...(t && y ? delta(t.linksChecked, y.linksChecked) : {})}
          intent="good"
          caption="vs. yesterday"
        />
        <StatTile
          label="Blocked"
          value={number(t?.linksBlocked ?? 0)}
          icon="shield-check"
          caption="malicious, stopped at the click"
        />
        <StatTile
          label="Awaiting review"
          value={number(stats?.waiting.links ?? 0)}
          icon="search"
          caption="held at the click"
        />
        <StatTile
          label="Median verdict time"
          value={t?.linkMedianMs != null ? (t.linkMedianMs / 1000).toFixed(1) : '—'}
          unit={t?.linkMedianMs != null ? 's' : undefined}
          icon="activity"
          caption="from click to verdict"
        />
      </div>

      <Card
        title="Clicked links"
        description="A held link shows a warning over the page until you decide."
        action={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon="file-text"
              disabled={rows.length === 0}
              onClick={() => exportCsv('aegis-links', rows)}
            >
              Export
            </Button>
            <Button
              size="sm"
              icon="check"
              onClick={() => setTab('held')}
              disabled={!stats?.waiting.links}
            >
              Review held
            </Button>
          </div>
        }
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <Tabs<LinkTab>
            items={[
              { value: 'held', label: 'Awaiting review', count: counts?.held || undefined },
              { value: 'blocked', label: 'Blocked', count: counts?.blocked || undefined },
              { value: 'allowed', label: 'Allowed' },
              { value: 'all', label: 'All' }
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchField
            className="w-[320px]"
            placeholder="Filter by URL or reason"
            aria-label="Filter links"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {rows.length > 0 ? (
          <ThreatTable
            columns={LINK_COLUMNS}
            rows={rows.map(linkRow)}
            onRowClick={(i) => onOpen(rows[i].id)}
          />
        ) : (
          <EmptyState
            icon={tab === 'held' || tab === 'blocked' ? 'shield-check' : 'globe'}
            title={filter ? 'No matches' : EMPTY[tab][0]}
            description={filter ? `No link in this list matches “${filter}”.` : EMPTY[tab][1]}
          />
        )}
      </Card>
    </>
  )
}
