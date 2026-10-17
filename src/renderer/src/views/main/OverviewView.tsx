// Overview — "What got through today" (figma/screens.md §1, adapted to one person's Mac):
// banner, coverage ring + four tiles, latest verdicts beside where Aegis can see, the scan log.

import type { MainRoute, OverviewStats } from '@shared/ipc'
import type { AppStatus, ServiceKey, ServiceState } from '@shared/types'
import { StatusDot } from '../../components/aegis'
import {
  AlertBanner,
  Button,
  Card,
  EmptyState,
  LogStream,
  ScoreRing,
  StatTile,
  ThreatTable
} from '../../components/ds'
import { clock, delta, displayUrl, number, shortClock } from '../../lib/format'
import { useInvoke, useLog } from '../../lib/hooks'
import { MIXED_COLUMNS, mixedRow } from './tables'

interface Layer {
  label: string
  state: ServiceState
  value: string
}

/** The protection layers a person can see at a glance; coverage is the share that is running. */
function layers(status: AppStatus | null, watchDownloads = true): Layer[] {
  const s = (k: ServiceKey): ServiceState =>
    status?.health.find((h) => h.key === k)?.state ?? 'pending'
  const sandbox: ServiceState = s('daytona') === 'ok' || s('docker') === 'ok' ? 'ok' : s('daytona')
  const links: ServiceState =
    s('safeBrowsing') === 'ok' || s('chalk') === 'ok' ? 'ok' : s('safeBrowsing')
  const watcher: ServiceState = watchDownloads ? s('downloads') : 'unconfigured'
  const word = (st: ServiceState, ok: string): string =>
    st === 'ok'
      ? ok
      : st === 'unconfigured'
        ? 'Not set up'
        : st === 'pending'
          ? 'Not checked'
          : st === 'down'
            ? 'Down'
            : 'Degraded'
  return [
    { label: 'Chrome extension', state: s('bridge'), value: word(s('bridge'), 'Connected') },
    { label: 'Link reputation', state: links, value: word(links, 'Checking') },
    {
      label: 'Download sandbox',
      state: sandbox,
      value: word(sandbox, s('daytona') === 'ok' ? 'Daytona' : 'Docker')
    },
    { label: 'AI review (Droid)', state: s('droid'), value: word(s('droid'), 'Reviewing') },
    { label: '~/Downloads watcher', state: watcher, value: word(watcher, 'Watching') },
    { label: 'Messages (Photon)', state: s('photon'), value: word(s('photon'), 'Answering') }
  ]
}

export default function OverviewView({
  status,
  stats,
  onOpen,
  onNavigate
}: {
  status: AppStatus | null
  stats: OverviewStats | undefined
  onOpen: (id: string) => void
  onNavigate: (r: MainRoute) => void
}): React.JSX.Element {
  const { data: recent } = useInvoke('scans:list', { kind: 'any', limit: 5 })
  const { data: settings } = useInvoke('settings:get')
  const log = useLog(8)
  const list = recent ?? []
  const all = layers(status, settings?.watchDownloads ?? true)
  const running = all.filter((l) => l.state === 'ok')
  const coverage = Math.round((running.length / all.length) * 100)
  const gaps = all.filter((l) => l.state !== 'ok')
  const t = stats?.today
  const y = stats?.yesterday

  // Banner: the newest malicious verdict today, else a missing required service.
  const today = new Date().toDateString()
  const worst = list.find(
    (s) => s.verdict === 'malicious' && new Date(s.createdAt).toDateString() === today
  )
  const down =
    status?.health.filter(
      (h) => h.required && (h.state === 'down' || h.state === 'unconfigured')
    ) ?? []

  return (
    <>
      {worst ? (
        <AlertBanner
          tone="critical"
          title={`${worst.action === 'quarantined' ? 'Quarantined' : 'Blocked'} ${worst.kind === 'link' ? displayUrl(worst.url) : worst.filename} at ${shortClock(worst.createdAt)}`}
          action={
            <Button variant="danger" size="sm" icon="file-search" onClick={() => onOpen(worst.id)}>
              View report
            </Button>
          }
        >
          {worst.reason ?? 'Malicious'} — seen in {worst.seenIn}. It never reached this Mac.
        </AlertBanner>
      ) : down.length > 0 ? (
        <AlertBanner
          tone="warning"
          title={`${down.map((d) => d.name).join(', ')} ${down.length > 1 ? 'are' : 'is'} not set up`}
          action={
            <Button
              variant="secondary"
              size="sm"
              icon="settings"
              onClick={() => onNavigate('settings')}
            >
              Open settings
            </Button>
          }
        >
          Aegis keeps checking what it can; risky downloads are held with “Can&apos;t scan right
          now” until a sandbox is available.
        </AlertBanner>
      ) : null}

      <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-5">
        <Card highlight>
          <div className="flex flex-col items-center gap-4 text-center">
            <ScoreRing value={coverage} label="Coverage" />
            <p className="m-0 max-w-[30ch] text-[13px] leading-[19px] text-ink-muted">
              Share of Aegis&apos;s checks that are running.{' '}
              {gaps.length === 0 ? 'Nothing is missing.' : `${gaps[0].label} is the gap.`}
            </p>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-5">
          <StatTile
            label="Links checked"
            value={number(t?.linksChecked ?? 0)}
            icon="globe"
            {...(t && y ? delta(t.linksChecked, y.linksChecked) : {})}
            intent="good"
            caption="vs. yesterday"
            points={stats && stats.spark.links.some(Boolean) ? stats.spark.links : undefined}
          />
          <StatTile
            label="Links blocked"
            value={number(t?.linksBlocked ?? 0)}
            icon="shield-check"
            caption={t?.linksHeld ? `${t.linksHeld} held at the click` : 'today'}
          />
          <StatTile
            label="Files scanned"
            value={number(t?.filesScanned ?? 0)}
            icon="file-search"
            caption={`${t?.filesSandboxed ?? 0} opened in a sandbox`}
          />
          <StatTile
            label="Files held"
            value={number((t?.filesHeld ?? 0) + (t?.filesQuarantined ?? 0))}
            icon="lock"
            caption="waiting on your decision"
            points={stats && stats.spark.files.some(Boolean) ? stats.spark.files : undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5">
        <Card
          title="Latest verdicts"
          description="Every link you clicked and file you downloaded, newest first."
          action={
            <Button variant="ghost" size="sm" iconEnd="arrow" onClick={() => onNavigate('links')}>
              All links
            </Button>
          }
        >
          {list.length > 0 ? (
            <ThreatTable
              columns={MIXED_COLUMNS}
              rows={list.map(mixedRow)}
              onRowClick={(i) => onOpen(list[i].id)}
            />
          ) : (
            <EmptyState
              icon="radar"
              title="Nothing checked yet"
              description="Links you click and files you download in Chrome show up here with their verdict. Verdicts usually land in about a second."
            />
          )}
        </Card>
        <Card
          title="Where Aegis can see"
          description="A click Aegis never sees is a click it never checked."
        >
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {all.map((l) => (
              <li key={l.label} className="flex items-center justify-between gap-3">
                <span className="text-[13px] leading-[19px] text-ink-muted">{l.label}</span>
                <StatusDot state={l.state} label={l.value} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Scan log" description="Raw, as the scanners report it.">
        {log.length > 0 ? (
          <LogStream
            lines={log.map((l) => ({
              time: clock(l.at),
              level: l.level ?? undefined,
              text: l.text
            }))}
          />
        ) : (
          <p className="m-0 text-[13px] text-ink-muted">No events yet.</p>
        )}
      </Card>
    </>
  )
}
