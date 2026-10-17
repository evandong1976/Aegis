import { useCallback, useEffect, useState } from 'react'
import type { InvokeChannel, IpcInvoke } from '@shared/ipc'
import type { AppStatus, LogEntry } from '@shared/types'

/** Live app status: fetched once, then pushed from the main process on every change. */
export function useStatus(): AppStatus | null {
  const [status, setStatus] = useState<AppStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.aegis.invoke('status:get').then((s) => alive && setStatus(s))
    const off = window.aegis.on('status:changed', setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

/**
 * Calls an IPC channel on mount and again whenever a scan changes; `reload` calls it on demand.
 */
export function useInvoke<C extends InvokeChannel>(
  channel: C,
  ...args: IpcInvoke[C]['args']
): {
  data: IpcInvoke[C]['result'] | undefined
  reload: () => void
  set: (v: IpcInvoke[C]['result']) => void
} {
  const [data, setData] = useState<IpcInvoke[C]['result']>()
  const key = JSON.stringify(args)
  const reload = useCallback(() => {
    void window.aegis.invoke(channel, ...(JSON.parse(key) as IpcInvoke[C]['args'])).then(setData)
  }, [channel, key])
  useEffect(reload, [reload])
  useEffect(() => window.aegis.on('scans:changed', reload), [reload])
  return { data, reload, set: setData }
}

/** The scan log: recent lines, then every new one as it is recorded. */
export function useLog(limit = 8): LogEntry[] {
  const [lines, setLines] = useState<LogEntry[]>([])
  useEffect(() => {
    let alive = true
    void window.aegis.invoke('log:list', limit).then((l) => alive && setLines(l))
    const off = window.aegis.on('log:appended', (entry) =>
      setLines((prev) => [...prev, entry].slice(-limit))
    )
    return () => {
      alive = false
      off()
    }
  }, [limit])
  return lines
}
