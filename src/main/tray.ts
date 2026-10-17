// Menu bar icon and menu: status line, Open panel, Open Aegis, Pause 15 min, Quit.

import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import type { AppStatus, ProtectionState } from '@shared/types'

const STATUS_LINE: Record<ProtectionState, string> = {
  protected: 'Protected',
  scanning: 'Scanning…',
  degraded: 'Degraded: a service is down',
  blocked: 'Blocked a threat',
  paused: 'Paused'
}

export interface TrayActions {
  openPanel(): void
  openMain(): void
  pause(): void
  resume(): void
  quit(): void
}

let tray: Tray | null = null

function resource(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', name)
    : join(app.getAppPath(), 'resources', name)
}

function icon(state: ProtectionState): Electron.NativeImage {
  const alert = state === 'degraded' || state === 'blocked'
  const img = nativeImage.createFromPath(
    resource(alert ? 'trayAlertTemplate.png' : 'trayTemplate.png')
  )
  img.setTemplateImage(true)
  return img
}

export function initTray(): Tray {
  tray = new Tray(icon('protected'))
  tray.setToolTip('Aegis')
  return tray
}

export function updateTray(status: AppStatus, actions: TrayActions): void {
  if (!tray) return
  const state = status.protection
  tray.setImage(icon(state))
  const until = status.pausedUntil
    ? ` until ${new Date(status.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : ''
  const line = `Aegis: ${STATUS_LINE[state]}${state === 'paused' ? until : ''}`
  tray.setToolTip(line)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: line, enabled: false },
      { type: 'separator' },
      { label: 'Open panel', accelerator: 'Control+Alt+A', click: actions.openPanel },
      { label: 'Open Aegis', click: actions.openMain },
      state === 'paused'
        ? { label: 'Resume protection', click: actions.resume }
        : { label: 'Pause 15 min', click: actions.pause },
      { type: 'separator' },
      { label: 'Quit Aegis', click: actions.quit }
    ])
  )
}
