import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
// Fonts and icons are all bundled locally, no CDN dependency (works offline/on intranet)
import 'remixicon/fonts/remixicon.css'
import 'katex/dist/katex.min.css'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
