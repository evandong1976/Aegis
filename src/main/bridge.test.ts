import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { EXTENSION_ORIGIN } from '@shared/constants'
import {
  DOWNLOAD_META_HEADER,
  encodeDownloadMeta,
  type DownloadMeta,
  type QuarantinedRequest
} from '@shared/bridge'
import { isAllowedHost, isAllowedOrigin, startBridge } from './bridge'

describe('origin check', () => {
  it('accepts only our extension', () => {
    expect(isAllowedOrigin(EXTENSION_ORIGIN)).toBe(true)
    expect(isAllowedOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
    expect(isAllowedOrigin(undefined)).toBe(false)
  })

  it('rejects rebinding hosts', () => {
    expect(isAllowedHost('127.0.0.1:47321', 47321)).toBe(true)
    expect(isAllowedHost('evil.example:47321', 47321)).toBe(false)
  })
})

describe('bridge server', () => {
  let server: Server
  let port = 0
  let pings = 0
  const trusted: string[] = []
  const downloads: Array<{ bytes: Buffer; meta: DownloadMeta }> = []
  const quarantined: QuarantinedRequest[] = []

  beforeAll(async () => {
    // Port 0 picks a free port; the Host check needs the real one, so start, read it, restart.
    const probe = await startBridge(deps(0))
    port = (probe.address() as AddressInfo).port
    await new Promise((r) => probe.close(r))
    server = await startBridge(deps(port))
  })
  afterAll(() => new Promise((r) => server.close(r)))

  function deps(p: number): Parameters<typeof startBridge>[0] {
    return {
      port: p,
      version: '0.0.0-test',
      getStatus: () => ({ protection: 'protected', mode: 'block' }),
      onPing: () => pings++,
      trust: (d) => {
        trusted.push(d)
        return d.toLowerCase()
      },
      page: async () => ({ paused: false, links: [], scamText: null, sender: null }),
      click: async () => {},
      download: (bytes, meta) => {
        downloads.push({ bytes, meta })
        return 'scan-1'
      },
      downloadQuarantined: async (req) => {
        quarantined.push(req)
        return null
      },
      scanStatus: (id) =>
        id === 'scan-1'
          ? { scanId: id, status: 'done', verdict: 'unknown', summary: 'Held.', held: true }
          : null,
      downloadLimitBytes: 1024
    }
  }

  const url = (path: string): string => `http://127.0.0.1:${port}${path}`

  it('rejects requests without our Origin', async () => {
    const res = await fetch(url('/status'), { method: 'POST' })
    expect(res.status).toBe(403)
    const other = await fetch(url('/status'), {
      method: 'POST',
      headers: { origin: 'https://evil.example' }
    })
    expect(other.status).toBe(403)
  })

  it('serves /status to the extension', async () => {
    const res = await fetch(url('/status'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN }
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(EXTENSION_ORIGIN)
    expect(await res.json()).toMatchObject({ app: 'aegis', protection: 'protected' })
  })

  it('records pings and trusts domains', async () => {
    const headers = { origin: EXTENSION_ORIGIN, 'content-type': 'application/json' }
    await fetch(url('/ping'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ extensionVersion: '0.1.0', at: new Date().toISOString() })
    })
    expect(pings).toBe(1)
    const res = await fetch(url('/trust'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain: 'example.com' })
    })
    expect(res.status).toBe(200)
    expect(trusted).toEqual(['example.com'])
  })

  it('rejects malformed bodies', async () => {
    const res = await fetch(url('/trust'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: '' })
    })
    expect(res.status).toBe(400)
  })

  it('takes a download as bytes with its metadata in a header', async () => {
    const meta: DownloadMeta = {
      chromeDownloadId: 7,
      url: 'https://example.com/f',
      filename: 'résumé (final).sh'
    }
    const res = await fetch(url('/download'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN, [DOWNLOAD_META_HEADER]: encodeDownloadMeta(meta) },
      body: new Uint8Array([1, 2, 3, 0, 255])
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scanId: 'scan-1' })
    expect(downloads.at(-1)?.meta).toEqual(meta)
    expect([...downloads.at(-1)!.bytes]).toEqual([1, 2, 3, 0, 255])
  })

  it('refuses a download over the limit (413) or without metadata (400)', async () => {
    const before = downloads.length
    const big = await fetch(url('/download'), {
      method: 'POST',
      headers: {
        origin: EXTENSION_ORIGIN,
        [DOWNLOAD_META_HEADER]: encodeDownloadMeta({ chromeDownloadId: 1, url: 'u', filename: 'f' })
      },
      body: new Uint8Array(2048)
    })
    expect(big.status).toBe(413)
    const bare = await fetch(url('/download'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN },
      body: new Uint8Array(4)
    })
    expect(bare.status).toBe(400)
    expect(downloads.length).toBe(before)
  })

  it('takes quarantined downloads and answers scan status', async () => {
    const res = await fetch(url('/download/quarantined'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        chromeDownloadId: 3,
        url: 'https://example.com/a.sh',
        path: '/Users/x/Downloads/.aegis-quarantine/a.sh.aegis',
        filename: 'a.sh',
        reason: 'fetch_failed'
      })
    })
    expect(await res.json()).toEqual({ scanId: null })
    expect(quarantined.at(-1)?.reason).toBe('fetch_failed')

    const scan = await fetch(url('/scan/scan-1'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN }
    })
    expect(await scan.json()).toMatchObject({ verdict: 'unknown', held: true })
    const missing = await fetch(url('/scan/nope'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN }
    })
    expect(missing.status).toBe(404)
  })

  it('marks routes from later milestones as not implemented', async () => {
    const res = await fetch(url('/inspect'), {
      method: 'POST',
      headers: { origin: EXTENSION_ORIGIN },
      body: '{}'
    })
    expect(res.status).toBe(501)
    expect(await res.json()).toMatchObject({ notImplemented: true })
  })
})
