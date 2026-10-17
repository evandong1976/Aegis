// Dev aid: with AEGIS_CAPTURE_DIR set, saves PNGs of the main window (one per route in
// AEGIS_CAPTURE_ROUTES, comma-separated) and of the panel, so a headless session can check the UI
// against the Figma references. Does nothing otherwise.

import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import type { MainRoute } from '@shared/ipc'

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
  reportId?: string
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
    await wait(5000)
    await save(dir, 'panel', opts.panel())
    for (const route of routes) {
      opts.main()?.webContents.send('navigate', {
        route,
        scanId: route === 'report' ? opts.reportId : undefined
      })
      await wait(1200)
      await save(dir, route, opts.main())
    }
  })()
}
