import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
// Bundle icons and fonts locally (no CDN dependency; previously ri- icons showed blank because the font wasn't loaded)
import 'remixicon/fonts/remixicon.css'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import './index.css'
import App from './App.tsx'
import { initTheme } from '@/lib/settings'

// Apply the saved light/dark theme on startup (before render, to avoid a white/black flash)
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
