// The mini panel (MEGA_PROMPT §5.8): ~360 × 480, frameless, top-right of the screen the mouse is
// on, always on top, on every Space including full-screen apps, opens without stealing focus.

import { BrowserWindow, screen } from 'electron'
import { PANEL_MARGIN, PANEL_SIZE } from '@shared/constants'
import { loadRoute, lockDown, secureWebPreferences } from './windows'

let panel: BrowserWindow | null = null

function create(): BrowserWindow {
  const win = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    // A macOS panel window floats over full-screen apps and doesn't activate the app.
    type: 'panel',
    vibrancy: 'popover',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: secureWebPreferences
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  lockDown(win)
  win.on('closed', () => {
    panel = null
  })
  loadRoute(win, '/panel')
  return win
}

function position(win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width } = display.workArea
  win.setPosition(x + width - PANEL_SIZE.width - PANEL_MARGIN, y + PANEL_MARGIN, false)
}

export function initPanel(): void {
  if (!panel) panel = create()
}

export function showPanel(): void {
  if (!panel) panel = create()
  position(panel)
  panel.showInactive()
}

export function hidePanel(): void {
  panel?.hide()
}

export function togglePanel(): void {
  if (panel?.isVisible()) hidePanel()
  else showPanel()
}

export function getPanel(): BrowserWindow | null {
  return panel
}
