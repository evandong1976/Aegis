// Dev aid: with AEGIS_CAPTURE_DIR set, saves PNGs of the main window (one per route in
// AEGIS_CAPTURE_ROUTES, comma-separated) and of the panel, so a headless session can check the UI
// against the Figma references. At the end it also writes status.json (live status, including every
// health check) and log.json (the scan log), as evidence for scripts/verify.sh. Does nothing
// otherwise. AEGIS_CAPTURE_DELAY_MS (default 5000) holds the capture back, so an end-to-end run
// can drive the app first and capture what it did.

import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import type { MainRoute } from '@shared/ipc'
import { status } from './status'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function save(dir: string, name: string, win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed()) return
  const image = await win.webContents.capturePage()
  await writeFile(join(dir, `${name}.png`), image.toPNG())
  console.log(`[capture] wrote ${name}.png`)
}

export function scheduleCapture(opts: {
  main: () => BrowserWindow | null
  panel: () => BrowserWindow | null
  /** Looked up when the report is captured, so it can be a scan made after launch. */
  reportId?: () => string | undefined
}): void {
  const dir = process.env.AEGIS_CAPTURE_DIR
  if (!dir) return
  const routes = (process.env.AEGIS_CAPTURE_ROUTES ?? 'overview').split(',') as MainRoute[]
  for (const win of [opts.main(), opts.panel()]) {
    win?.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning')
        console.log(`[renderer ${e.level}] ${e.message}`)
    })
  }
  void (async () => {
    await wait(Number(process.env.AEGIS_CAPTURE_DELAY_MS) || 5000)
    await save(dir, 'panel', opts.panel())
    for (const route of routes) {
      opts.main()?.webContents.send('navigate', {
        route,
        scanId: route === 'report' ? opts.reportId?.() : undefined
      })
      await wait(1200)
      await save(dir, route, opts.main())
      if (process.env.AEGIS_CAPTURE_SCROLL) {
        // Scroll the content column to the bottom: the rail and title bar must not move.
        await opts
          .main()
          ?.webContents.executeJavaScript(
            "document.querySelector('.app-shell__content')?.scrollTo({ top: 1e6 })"
          )
        await wait(400)
        await save(dir, `${route}-scrolled`, opts.main())
      }
    }
    await writeFile(join(dir, 'status.json'), JSON.stringify(status.get(), null, 2))
    await writeFile(join(dir, 'log.json'), JSON.stringify(status.recent(200), null, 2))
    console.log('[capture] wrote status.json, log.json')
  })()
}
