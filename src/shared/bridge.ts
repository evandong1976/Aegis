// The HTTP contract between the Chrome extension and the app's bridge (127.0.0.1 only).
// Every request must carry `Origin: chrome-extension://<EXTENSION_ID>`. Every route is POST, reads
// included: Chrome leaves Origin off an extension's GET requests to hosts it has permission for.

import { z } from 'zod'
import { LinkVerdictSchema, ScamTextResultSchema, ScanStatusSchema, VerdictSchema } from './types'

export const BRIDGE_ROUTES = {
  status: { method: 'POST', path: '/status' },
  ping: { method: 'POST', path: '/ping' },
  page: { method: 'POST', path: '/page' },
  download: { method: 'POST', path: '/download' },
  downloadQuarantined: { method: 'POST', path: '/download/quarantined' },
  inspect: { method: 'POST', path: '/inspect' },
  scan: { method: 'POST', path: '/scan/:id' },
  trust: { method: 'POST', path: '/trust' }
} as const

export type BridgeRoute = keyof typeof BRIDGE_ROUTES

export const BridgeErrorSchema = z.object({
  error: z.string(),
  /** Set for routes whose milestone hasn't landed yet. */
  notImplemented: z.boolean().optional()
})
export type BridgeError = z.infer<typeof BridgeErrorSchema>

// POST /status
export const StatusResponseSchema = z.object({
  app: z.literal('aegis'),
  version: z.string(),
  protection: z.enum(['protected', 'scanning', 'degraded', 'blocked', 'paused']),
  mode: z.enum(['block', 'warn'])
})
export type StatusResponse = z.infer<typeof StatusResponseSchema>

// POST /ping — heartbeat from the offscreen document
export const PingRequestSchema = z.object({
  extensionVersion: z.string(),
  at: z.string()
})
export type PingRequest = z.infer<typeof PingRequestSchema>
export const PingResponseSchema = z.object({ ok: z.literal(true) })

// POST /page — links, visible text and (on webmail) the sender
export const PageLinkSchema = z.object({
  href: z.string(),
  /** Visible link text, trimmed. */
  text: z.string().max(500)
})
export const PageRequestSchema = z.object({
  tabId: z.number().int(),
  pageUrl: z.string(),
  links: z.array(PageLinkSchema).max(2000),
  /** Visible main-content text, capped at PAGE_TEXT_CAP. Untrusted. */
  text: z.string().max(8000).optional(),
  sender: z
    .object({
      displayName: z.string(),
      address: z.string(),
      replyTo: z.string().optional()
    })
    .optional()
})
export type PageRequest = z.infer<typeof PageRequestSchema>
export const PageResponseSchema = z.object({
  links: z.array(LinkVerdictSchema),
  scamText: ScamTextResultSchema.nullable(),
  sender: z.object({ verdict: VerdictSchema, reasons: z.array(z.string()) }).nullable()
})
export type PageResponse = z.infer<typeof PageResponseSchema>

// POST /download — metadata in headers, streamed bytes in the body
export const DOWNLOAD_META_HEADER = 'x-aegis-download'
export const DownloadMetaSchema = z.object({
  chromeDownloadId: z.number().int(),
  url: z.string(),
  referrer: z.string().optional(),
  filename: z.string(),
  mime: z.string().optional(),
  size: z.number().int().nonnegative().optional()
})
export type DownloadMeta = z.infer<typeof DownloadMetaSchema>
export const DownloadResponseSchema = z.object({ scanId: z.string() })

// POST /download/quarantined — Chrome saved it into .aegis-quarantine, or it finished before cancel
export const QuarantinedRequestSchema = z.object({
  chromeDownloadId: z.number().int(),
  url: z.string(),
  path: z.string(),
  filename: z.string(),
  reason: z.enum(['fetch_failed', 'already_finished', 'too_large'])
})
export type QuarantinedRequest = z.infer<typeof QuarantinedRequestSchema>

// POST /inspect — detonate one link in a sandbox (the full URL, only on user request)
export const InspectRequestSchema = z.object({
  url: z.string(),
  tabId: z.number().int().optional()
})
export type InspectRequest = z.infer<typeof InspectRequestSchema>
export const InspectResponseSchema = z.object({ scanId: z.string() })

// POST /scan/:id
export const ScanStatusResponseSchema = z.object({
  scanId: z.string(),
  status: ScanStatusSchema,
  verdict: VerdictSchema.nullable(),
  summary: z.string().nullable(),
  /** True when the file is held for the user's decision. */
  held: z.boolean()
})
export type ScanStatusResponse = z.infer<typeof ScanStatusResponseSchema>

// POST /trust
export const TrustRequestSchema = z.object({ domain: z.string().min(1) })
export type TrustRequest = z.infer<typeof TrustRequestSchema>
export const TrustResponseSchema = z.object({ ok: z.literal(true), domain: z.string() })
