// Formatting for machine output. Everything these return is shown in the mono scale.

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

export function shortClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Today, 13:58" / "Oct 14, 09:12". */
export function dayClock(iso: string): string {
  const d = new Date(iso)
  const day =
    d.toDateString() === new Date().toDateString()
      ? 'Today'
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day}, ${shortClock(iso)}`
}

export function size(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** URL without the scheme, as people read it: "login-northwlnd-io.sbs/sso". */
export function displayUrl(url: string | null): string {
  if (!url) return '—'
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '')
}

export function hostOf(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return displayUrl(url).split('/')[0]
  }
}

export function seconds(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

export function shortHash(sha: string | null): string {
  if (!sha) return '—'
  return `${sha.slice(0, 4)}…${sha.slice(-4)}`
}

export function number(n: number): string {
  return n.toLocaleString()
}

/** Delta against yesterday, for StatTile: undefined when there is no basis. */
export function delta(
  today: number,
  yesterday: number
): { delta: string; direction: 'up' | 'down' } | undefined {
  if (today === yesterday) return undefined
  if (yesterday === 0) return { delta: String(today), direction: 'up' }
  const pct = Math.round(((today - yesterday) / yesterday) * 100)
  return { delta: `${Math.abs(pct)}%`, direction: pct >= 0 ? 'up' : 'down' }
}
