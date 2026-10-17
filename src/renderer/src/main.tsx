import '@ds/tokens.css'
import '@ds/components/bundle.css'
import './assets/main.css'
import './assets/aegis.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Follow the system appearance: Night ops (dark) or Daylight (light).
const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
}
applyTheme()
media.addEventListener('change', applyTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
