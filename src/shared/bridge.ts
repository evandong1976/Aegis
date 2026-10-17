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
  trust: { method: 'POST', path: '/trust' },
  click: { method: 'POST', path: '/click' }
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
  /** Set at a click: wait longer (up to TIMEOUTS_MS.linkAtClick) for lookups still running. */
  urgent: z.boolean().optional(),
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
  /** Protection is paused: no verdicts, nothing outlined or held. */
  paused: z.boolean(),
  links: z.array(LinkVerdictSchema),
  scamText: ScamTextResultSchema.nullable(),
  sender: z.object({ verdict: VerdictSchema, reasons: z.array(z.string()) }).nullable()
})
export type PageResponse = z.infer<typeof PageResponseSchema>

// POST /click — what happened when the user clicked a link; sent again with the same clickId
// when the user decides in the click guard. The app looks the verdict up itself.
export const ClickRequestSchema = z.object({
  clickId: z.string().uuid(),
  tabId: z.number().int().optional(),
  pageUrl: z.string(),
  href: z.string(),
  linkText: z.string().max(500),
  /** allowed: it opened; held: the guard is up; blocked: the user went back. */
  decision: z.enum(['allowed', 'held', 'blocked']),
  /** Time from the click to the verdict, in the extension. */
  verdictMs: z.number().nonnegative(),
  /** The user chose Trust this site. */
  trusted: z.boolean().optional()
})
export type ClickRequest = z.infer<typeof ClickRequestSchema>

// POST /download — metadata in a header, the file's bytes as the body (at most
// IN_MEMORY_DOWNLOAD_LIMIT_BYTES; larger files take the quarantine path). The bytes were fetched in
// memory by the offscreen document and never written to disk.
export const DOWNLOAD_META_HEADER = 'x-aegis-download'
/** Header values must be ASCII; file names often aren't. */
export const encodeDownloadMeta = (meta: DownloadMeta): string =>
  encodeURIComponent(JSON.stringify(meta))
export const decodeDownloadMeta = (value: string): DownloadMeta =>
  DownloadMetaSchema.parse(JSON.parse(decodeURIComponent(value)))
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

// POST /download/quarantined — Chrome saved it into .aegis-quarantine, or it finished before cancel.
// The app moves it into its own quarantine at once; `path` must be inside the downloads folder.
export const QuarantinedRequestSchema = z.object({
  chromeDownloadId: z.number().int(),
  url: z.string(),
  referrer: z.string().optional(),
  path: z.string(),
  filename: z.string(),
  reason: z.enum(['fetch_failed', 'already_finished', 'too_large'])
})
export type QuarantinedRequest = z.infer<typeof QuarantinedRequestSchema>
/** scanId is null when the file was gone or already being scanned (the watcher got it first). */
export const QuarantinedResponseSchema = z.object({ scanId: z.string().nullable() })

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
