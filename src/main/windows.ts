// Window helpers shared by the main window and the mini panel. One renderer bundle; each window
// routes on the URL hash (#/main, #/panel).

import { BrowserWindow, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import type { MainRoute } from '@shared/ipc'

export const secureWebPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false
}

/** Matches the design system's `ground` token so windows don't flash white. */
export function groundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#04111f' : '#edf4f9'
}

export function loadRoute(win: BrowserWindow, hash: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

/** No remote content in the renderer: block navigation and send real links to the browser. */
export function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) event.preventDefault()
  })
}

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setQuitting(): void {
  quitting = true
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function openMainWindow(route?: MainRoute, scanId?: string): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (route) mainWindow.webContents.send('navigate', { route, scanId })
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'Aegis',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 14 },
    backgroundColor: groundColor(),
    webPreferences: secureWebPreferences
  })
  lockDown(win)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  // Closing the window never quits Aegis; it keeps protecting in the background.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  const query = route ? `/main/${route}${scanId ? `/${scanId}` : ''}` : '/main'
  loadRoute(win, query)
  mainWindow = win
  return win
}
