// The renderer's only door into the main process: a small, typed API over fixed channels.
// Runs sandboxed, so it imports nothing at runtime except electron and our own constants.

import { contextBridge, ipcRenderer } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  type AegisApi,
  type EventChannel,
  type InvokeChannel,
  type SendChannel
} from '@shared/ipc'

const api: AegisApi = {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.includes(channel as InvokeChannel))
      throw new Error(`Unknown channel ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel, ...args) {
    if (!SEND_CHANNELS.includes(channel as SendChannel))
      throw new Error(`Unknown channel ${channel}`)
    ipcRenderer.send(channel, ...args)
  },
  on(channel, listener) {
    if (!EVENT_CHANNELS.includes(channel as EventChannel))
      throw new Error(`Unknown channel ${channel}`)
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0]
    ): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('aegis', api)
