// Offscreen document: lives as long as Chrome does, so it owns long-running work. It keeps the
// bridge heartbeat, and fetches stopped downloads into memory and hands them to the app
// (MEGA_PROMPT §5.1): the same URL with the user's cookies, so logged-in downloads work, and the
// bytes are never written to disk. The cookies never leave Chrome; only the bytes go to the app.

import { IN_MEMORY_DOWNLOAD_LIMIT_BYTES } from '@shared/constants'
import { fetchScan, ping, postDownload } from './bridge'
import type { InterceptJob, OffscreenToWorker, WorkerToOffscreen } from './messages'

const HEARTBEAT_MS = 30_000
const POLL_MS = 1500
/** Stop asking after this long; the app keeps the scan and its report either way. */
const POLL_LIMIT_MS = 10 * 60 * 1000
let connected: boolean | null = null

async function beat(): Promise<void> {
  const ok = await ping()
  if (ok !== connected) {
    connected = ok
    // Tell the worker so it can update the toolbar badge.
    void chrome.runtime.sendMessage({ type: 'bridge-changed', connected: ok }).catch(() => {})
  }
}

void beat()
setInterval(() => void beat(), HEARTBEAT_MS)

function tell(message: OffscreenToWorker): void {
  void chrome.runtime.sendMessage(message).catch(() => {})
}

/** The file name from Content-Disposition (RFC 6266, `filename*` first), if any. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  return plain ? (plain[2] ?? plain[1]).trim() || null : null
}

function nameFor(job: InterceptJob, res: Response | null): string {
  const fromHeader = dispositionName(res?.headers.get('content-disposition') ?? null)
  if (fromHeader) return fromHeader
  if (job.filename) return job.filename.split(/[\\/]/).pop() || job.filename
  try {
    const url = new URL(res?.url || job.url)
    if (url.protocol === 'data:') return 'download'
    const last = url.pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : url.hostname
  } catch {
    return 'download'
  }
}

/**
 * True when the server clearly sent something other than the file: an HTML page (a sign-in or
 * error page) for a download that isn't a web page.
 */
function looksWrong(res: Response, name: string, job: InterceptJob): boolean {
  const type = res.headers.get('content-type') ?? ''
  if (!/text\/html/i.test(type)) return false
  return !/\.(html?|xhtml|svg|xml)$/i.test(name) && !/html/i.test(job.mime ?? '')
}

/** Reads the body into memory, giving up past the limit. */
async function readCapped(res: Response, limit: number): Promise<Blob | 'too_large'> {
  if (Number(res.headers.get('content-length') ?? 0) > limit) return 'too_large'
  if (!res.body) return new Blob([await res.arrayBuffer()])
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      void reader.cancel()
      return 'too_large'
    }
    chunks.push(value)
  }
  return new Blob(chunks as BlobPart[])
}

async function intercept(job: InterceptJob): Promise<void> {
  let res: Response | null = null
  const fail = (reason: 'fetch_failed' | 'too_large' | 'app_down'): void =>
    tell({ type: 'aegis:fetch-failed', job, filename: nameFor(job, res), reason })
  try {
    res = await fetch(job.url, { credentials: 'include', cache: 'no-store' })
  } catch {
    fail('fetch_failed')
    return
  }
  const name = nameFor(job, res)
  if (!res.ok || looksWrong(res, name, job)) {
    fail('fetch_failed')
    return
  }
  let body: Blob | 'too_large'
  try {
    body = await readCapped(res, IN_MEMORY_DOWNLOAD_LIMIT_BYTES)
  } catch {
    fail('fetch_failed')
    return
  }
  if (body === 'too_large') {
    fail('too_large')
    return
  }
  const posted = await postDownload(body, {
    chromeDownloadId: job.downloadId,
    url: job.url,
    referrer: job.referrer || undefined,
    filename: name,
    mime: res.headers.get('content-type') ?? job.mime ?? undefined,
    size: body.size
  })
  if (!posted) {
    fail('app_down')
    return
  }
  if ('tooLarge' in posted) {
    fail('too_large')
    return
  }
  await watch(posted.scanId, name)
}

/** Polls the app until the scan has a verdict, telling the worker as it goes. */
async function watch(scanId: string, filename: string): Promise<void> {
  tell({ type: 'aegis:scan-update', scanId, filename, scan: null, final: false })
  const until = Date.now() + POLL_LIMIT_MS
  let last = ''
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const scan = await fetchScan(scanId)
    if (!scan) continue
    const final = scan.status === 'done' || scan.status === 'failed'
    const key = `${scan.status}:${scan.verdict}`
    if (key !== last || final) tell({ type: 'aegis:scan-update', scanId, filename, scan, final })
    last = key
    if (final) return
  }
  tell({ type: 'aegis:scan-update', scanId, filename, scan: null, final: true })
}

chrome.runtime.onMessage.addListener((message: WorkerToOffscreen, _sender, sendResponse) => {
  if (message?.type === 'aegis:intercept') {
    void intercept(message.job)
    sendResponse({ ok: true })
  } else if (message?.type === 'aegis:watch-scan') {
    void watch(message.scanId, message.filename)
    sendResponse({ ok: true })
  }
  return false
})
