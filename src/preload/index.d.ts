import type { AegisApi } from '../shared/ipc'

declare global {
  interface Window {
    aegis: AegisApi
  }
}
