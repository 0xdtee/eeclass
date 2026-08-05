import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
// 图标与字体本地打包(不依赖 CDN;之前 ri- 图标没加载字体全是空白)
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

// 启动即应用已存深浅色主题(在 render 之前,避免闪白/闪黑)
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
