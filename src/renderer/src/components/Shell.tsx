// The application shell from figma/screens.md: nav rail (236) on the left; on the right, a top bar
// (eyebrow + display-md title, search, status chip) over the page body.

import { useEffect, useRef, type ReactNode } from 'react'
import type { MainRoute, OverviewStats } from '@shared/ipc'
import type { AppStatus } from '@shared/types'
import { NavRail, SearchField, type NavItem } from './ds'

type NavRoute = Exclude<MainRoute, 'report'>

const NAV: NavItem<NavRoute>[] = [
  { value: 'overview', label: 'Overview', icon: 'dashboard' },
  { value: 'links', label: 'Links', icon: 'globe' },
  { value: 'downloads', label: 'Downloads', icon: 'file-search' },
  { value: 'messages', label: 'Messages', icon: 'message-square' },
  { value: 'accuracy', label: 'Accuracy', icon: 'chart-column' },
  { value: 'settings', label: 'Settings', icon: 'settings' }
]

const PROTECTION_WORD: Record<AppStatus['protection'], string> = {
  protected: 'Protected',
  scanning: 'Scanning',
  degraded: 'Degraded',
  blocked: 'Blocked a threat',
  paused: 'Paused'
}

function StatusChip({
  status,
  onClick
}: {
  status: AppStatus | null
  onClick: () => void
}): React.JSX.Element | null {
  if (!status) return null
  const tone =
    status.protection === 'protected' || status.protection === 'scanning'
      ? 'ok'
      : status.protection === 'blocked'
        ? 'down'
        : 'degraded'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface py-1.5 pr-3 pl-1.5 text-[13px] leading-[19px] font-semibold text-ink-muted hover:bg-surface-raised"
      aria-label={`Protection: ${PROTECTION_WORD[status.protection]}. Open connections`}
    >
      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-soft">
        <span className={`ae-dot ae-dot--${tone}`}>
          <span className="ae-dot__mark" aria-hidden="true" />
        </span>
      </span>
      <span>{PROTECTION_WORD[status.protection]}</span>
    </button>
  )
}

export function Shell({
  route,
  onNavigate,
  status,
  stats,
  eyebrow,
  title,
  search,
  onSearch,
  children
}: {
  route: MainRoute
  onNavigate: (r: NavRoute) => void
  status: AppStatus | null
  stats: OverviewStats | undefined
  eyebrow: string
  title: string
  search: string
  onSearch: (q: string) => void
  children: ReactNode
}): React.JSX.Element {
  const searchRef = useRef<HTMLInputElement>(null)

  // ⌘K focuses search (the shortcut chip is bound for real, per the SearchField README).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        onSearch('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearch])

  // Counts are what waits on you, never totals scanned (NavRail README).
  const items = NAV.map((n) => {
    const count =
      n.value === 'links'
        ? stats?.waiting.links
        : n.value === 'downloads'
          ? stats?.waiting.files
          : 0
    return count ? { ...n, count: String(count) } : n
  })
  const active: NavRoute = route === 'report' ? 'overview' : route

  return (
    <div className="flex min-h-full flex-col">
      <div className="titlebar drag flex-none" />
      <div className="app-shell flex-1">
        <div className="sticky top-0">
          <NavRail brand="Aegis" items={items} value={active} onSelect={onNavigate} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <header className="flex items-center gap-5">
            <div className="min-w-0">
              <p className="ae-label m-0 mb-1">{eyebrow}</p>
              <h1 className="display-md m-0 truncate text-ink">{title}</h1>
            </div>
            <div className="ml-auto w-full max-w-[420px]">
              <SearchField
                ref={searchRef}
                placeholder="Search URLs, files or hashes"
                shortcut="⌘K"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
            {status?.demo ? (
              <span
                className="ae-chip ae-chip--accent"
                title="AEGIS_DEMO=1: a throwaway database seeded from the Figma demo path"
              >
                Demo data
              </span>
            ) : null}
            <StatusChip status={status} onClick={() => onNavigate('settings')} />
          </header>
          {children}
        </div>
      </div>
    </div>
  )
}
