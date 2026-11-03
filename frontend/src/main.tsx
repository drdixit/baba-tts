import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ChatPage from './ChatPage.tsx'
import SettingsPage from './SettingsPage.tsx'
import QuickInputPopupPage from './QuickInputPopupPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/popup" element={<QuickInputPopupPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
