// Local HTTP bridge for the Chrome extension. Listens on 127.0.0.1 only and accepts a request
// only when its Origin is our extension's fixed ID (MEGA_PROMPT §5.1, §6 rule 5).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { ZodType } from 'zod'
import { BRIDGE_HOST, EXTENSION_ORIGIN } from '@shared/constants'
import {
  BRIDGE_ROUTES,
  PingRequestSchema,
  TrustRequestSchema,
  type BridgeError,
  type StatusResponse
} from '@shared/bridge'

const JSON_LIMIT_BYTES = 2 * 1024 * 1024

export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === EXTENSION_ORIGIN
}

/** Blocks DNS-rebinding: the Host header must be our loopback address. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `${BRIDGE_HOST}:${port}` || host === `localhost:${port}`
}

export interface BridgeDeps {
  port: number
  version: string
  getStatus(): Pick<StatusResponse, 'protection' | 'mode'>
  onPing(): void
  trust(domain: string): void
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function fail(res: ServerResponse, code: number, error: string, notImplemented?: boolean): void {
  const body: BridgeError = notImplemented ? { error, notImplemented } : { error }
  send(res, code, body)
}

async function readJson<T>(req: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > JSON_LIMIT_BYTES) throw new Error('Body too large')
    chunks.push(chunk as Buffer)
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
}

export function handleRequest(deps: BridgeDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = req.headers.origin
    if (!isAllowedOrigin(origin) || !isAllowedHost(req.headers.host, deps.port)) {
      fail(res, 403, 'Forbidden')
      return
    }
    res.setHeader('access-control-allow-origin', EXTENSION_ORIGIN)
    res.setHeader('vary', 'Origin')

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-aegis-download',
        'access-control-max-age': '600'
      })
      res.end()
      return
    }

    const path = new URL(req.url ?? '/', `http://${BRIDGE_HOST}`).pathname
    const route = `${req.method} ${path}`

    try {
      if (route === `GET ${BRIDGE_ROUTES.status.path}`) {
        const body: StatusResponse = { app: 'aegis', version: deps.version, ...deps.getStatus() }
        send(res, 200, body)
        return
      }
      if (route === `POST ${BRIDGE_ROUTES.ping.path}`) {
        await readJson(req, PingRequestSchema)
        deps.onPing()
        send(res, 200, { ok: true })
        return
      }
      if (route === `POST ${BRIDGE_ROUTES.trust.path}`) {
        const { domain } = await readJson(req, TrustRequestSchema)
        deps.trust(domain)
        send(res, 200, { ok: true, domain: domain.toLowerCase() })
        return
      }
      // Milestones 2, 3 and 7 fill these in; the contract is already in src/shared/bridge.ts.
      const pending = [
        BRIDGE_ROUTES.page,
        BRIDGE_ROUTES.download,
        BRIDGE_ROUTES.downloadQuarantined,
        BRIDGE_ROUTES.inspect
      ]
      if (
        pending.some((r) => route === `${r.method} ${r.path}`) ||
        /^GET \/scan\/[^/]+$/.test(route)
      ) {
        fail(res, 501, `${route} is not implemented yet`, true)
        return
      }
      fail(res, 404, 'Not found')
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : 'Bad request')
    }
  }
}

export function startBridge(deps: BridgeDeps): Promise<Server> {
  const server = createServer((req, res) => void handleRequest(deps)(req, res))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(deps.port, BRIDGE_HOST, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
