// The main window (#/main): Overview, Links, Downloads, Messages, Accuracy, Settings, and the
// Report a row opens. Shell and screens follow figma/screens.md; Report follows the Figma frame.

import { useCallback, useEffect, useState } from 'react'
import type { MainRoute } from '@shared/ipc'
import { Shell } from '../../components/Shell'
import { useInvoke, useStatus } from '../../lib/hooks'
import AccuracyView from './AccuracyView'
import DownloadsView from './DownloadsView'
import LinksView from './LinksView'
import MessagesView from './MessagesView'
import OverviewView from './OverviewView'
import ReportView from './ReportView'
import SearchView from './SearchView'
import SettingsView from './SettingsView'

const ROUTES: MainRoute[] = [
  'overview',
  'links',
  'downloads',
  'messages',
  'accuracy',
  'settings',
  'report'
]

const TITLES: Record<MainRoute, [eyebrow: string, title: string]> = {
  overview: ['Overview', 'What got through today'],
  links: ['Links', 'URL verdicts'],
  downloads: ['Downloads', 'File verdicts'],
  messages: ['Messages', 'Forwarded to Aegis'],
  accuracy: ['Accuracy', 'How often Aegis is right'],
  settings: ['Settings', 'This Mac'],
  report: ['Report', 'Report']
}

export default function MainApp({
  initialRoute,
  initialScanId
}: {
  initialRoute?: string
  initialScanId?: string
}): React.JSX.Element {
  const [route, setRoute] = useState<MainRoute>(
    ROUTES.includes(initialRoute as MainRoute) ? (initialRoute as MainRoute) : 'overview'
  )
  const [scanId, setScanId] = useState<string | undefined>(initialScanId)
  const [from, setFrom] = useState<MainRoute>('overview')
  const [search, setSearch] = useState('')
  const [reportTitle, setReportTitle] = useState<string | null>(null)
  const status = useStatus()
  const { data: stats, reload: reloadStats } = useInvoke('overview:get')

  useEffect(reloadStats, [status, reloadStats])
  // Each screen starts at the top, not where the last one was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route, scanId, search])
  useEffect(
    () =>
      window.aegis.on('navigate', ({ route: r, scanId: id }) => {
        setSearch('')
        setRoute(r)
        if (id) setScanId(id)
      }),
    []
  )

  const navigate = useCallback((r: MainRoute) => {
    setSearch('')
    setRoute(r)
  }, [])

  const openReport = useCallback(
    (id: string) => {
      setFrom(route === 'report' ? from : route)
      setScanId(id)
      setSearch('')
      setRoute('report')
    },
    [route, from]
  )

  const [eyebrow, title] =
    route === 'report'
      ? ['Report', reportTitle ?? 'Report']
      : search
        ? ['Search', `Results for “${search}”`]
        : TITLES[route]

  return (
    <Shell
      route={route === 'report' ? from : route}
      onNavigate={navigate}
      status={status}
      stats={stats}
      eyebrow={eyebrow}
      title={title}
      search={search}
      onSearch={setSearch}
    >
      {search ? (
        <SearchView query={search} onOpen={openReport} />
      ) : (
        <>
          {route === 'overview' && (
            <OverviewView status={status} stats={stats} onOpen={openReport} onNavigate={navigate} />
          )}
          {route === 'links' && <LinksView stats={stats} onOpen={openReport} />}
          {route === 'downloads' && <DownloadsView stats={stats} onOpen={openReport} />}
          {route === 'messages' && <MessagesView />}
          {route === 'accuracy' && <AccuracyView />}
          {route === 'settings' && <SettingsView status={status} />}
          {route === 'report' && (
            <ReportView scanId={scanId} onBack={() => navigate(from)} onTitle={setReportTitle} />
          )}
        </>
      )}
    </Shell>
  )
}
