// Results for the top bar's search (URL, file name or SHA-256), across links and files.

import { Card, EmptyState, ThreatTable } from '../../components/ds'
import { useInvoke } from '../../lib/hooks'
import { MIXED_COLUMNS, mixedRow } from './tables'

export default function SearchView({
  query,
  onOpen
}: {
  query: string
  onOpen: (id: string) => void
}): React.JSX.Element {
  const { data } = useInvoke('scans:list', { kind: 'any', search: query, limit: 100 })
  const rows = data ?? []
  return (
    <Card
      title={`${rows.length} result${rows.length === 1 ? '' : 's'}`}
      description="Matched on URL, file name or SHA-256. Esc clears the search."
    >
      {rows.length > 0 ? (
        <ThreatTable
          columns={MIXED_COLUMNS}
          rows={rows.map(mixedRow)}
          onRowClick={(i) => onOpen(rows[i].id)}
        />
      ) : (
        <EmptyState
          icon="search"
          title="No matches"
          description={`Nothing Aegis has checked matches “${query}”.`}
        />
      )}
    </Card>
  )
}
