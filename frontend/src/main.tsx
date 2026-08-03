import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
// 字体与图标全部本地打包,不依赖任何 CDN(离线/内网也能正常显示)
import 'remixicon/fonts/remixicon.css'
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
