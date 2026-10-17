// Constants shared by the main process, renderer and extension.
// File-type lists and thresholds come from MEGA_PROMPT.md §5.1 and §5.3.

export const APP_NAME = 'Aegis'
export const APP_ID = 'com.aegis.app'

/** Fixed Chrome extension ID, derived from the `key` in extension/manifest.json. */
export const EXTENSION_ID = 'onljkbhkoinihmjibfofcalimkolemam'
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`

export const DEFAULT_BRIDGE_PORT = 47321
export const BRIDGE_HOST = '127.0.0.1'
/** The extension counts as connected if it pinged within this window. */
export const EXTENSION_PING_TTL_MS = 2 * 60 * 1000

export const HEALTH_INTERVAL_MS = 60 * 1000
export const PAUSE_MS = 15 * 60 * 1000
export const PANEL_AUTO_CLOSE_MS = 8 * 1000
export const PANEL_SIZE = { width: 360, height: 480 } as const
export const PANEL_MARGIN = 12

export const DEFAULT_SANDBOX_DAILY_BUDGET = 200
export const DEFAULT_SANDBOX_CONCURRENCY = 3
export const IN_MEMORY_DOWNLOAD_LIMIT_BYTES = 200 * 1024 * 1024
export const PAGE_TEXT_CAP = 8000

/** Score bands: 0–29 clean, 30–69 suspicious, 70–100 malicious. Unknown is set, not scored. */
export const VERDICT_THRESHOLDS = { suspicious: 30, malicious: 70 } as const

/** Timeouts per step (MEGA_PROMPT.md §5.3). */
export const TIMEOUTS_MS = {
  tier1Local: 300,
  chalk: 1500,
  /** A page's links wait this long for lookups (RDAP, DNS, certificate logs, Safe Browsing). */
  linkLookups: 1500,
  /** At a click on a link whose lookups were still running: wait this much more. */
  linkAtClick: 4000,
  sandboxStart: 20_000,
  analyze: 60_000,
  capa: 90_000,
  detonatePageLoad: 20_000,
  detonateTotal: 45_000,
  droid: 120_000,
  scamTextLlm: 8000
} as const

export const ALWAYS_SCAN_EXTENSIONS = {
  executables: [
    'exe',
    'msi',
    'scr',
    'com',
    'dll',
    'app',
    'dmg',
    'pkg',
    'mpkg',
    'apk',
    'jar',
    'deb',
    'rpm',
    'elf'
  ],
  scripts: [
    'js',
    'vbs',
    'ps1',
    'bat',
    'cmd',
    'sh',
    'command',
    'py',
    'applescript',
    'scpt',
    'workflow'
  ],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'img'],
  documents: ['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'rtf', 'one'],
  web: ['html', 'htm', 'svg', 'xml', 'hta']
} as const

/** Passed through only after magic bytes confirm the real type. */
export const PASS_THROUGH_EXTENSIONS = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff'],
  audio: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
} as const

export const QUARANTINE_EXTENSION = '.aegis'
/**
 * Ignored by the watcher. The extension no longer saves into it: Chrome refuses download paths with
 * a part that starts with a dot (PLAN.md decision 31); the fallback is `<name>.aegis` instead.
 */
export const CHROME_QUARANTINE_DIR = '.aegis-quarantine'

export const SERVICE_NAMES = {
  bridge: 'Bridge',
  sqlite: 'Local store',
  daytona: 'Daytona',
  sandboxImage: 'Sandbox image',
  docker: 'Docker (fallback)',
  droid: 'Droid',
  photon: 'Photon',
  chalk: 'Chalk',
  safeBrowsing: 'Safe Browsing',
  downloads: 'Downloads folder',
  fnKey: 'fn key'
} as const
