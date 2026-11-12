import React from 'react';
import { createRoot } from 'react-dom/client';
import Toolkit from './app/toolkit';
import ResponsivePreview from './components/responsive-preview';
import { LanguageProvider } from './lib/i18n';
import './app/globals.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      {import.meta.env.DEV && window.location.pathname === '/__preview' ? <ResponsivePreview /> : <Toolkit />}
    </LanguageProvider>
  </React.StrictMode>,
);

// Outside React effects so StrictMode does not double-count page loads.
if (window.location.pathname.replace(/\/+$/, '') !== '/admin') {
  void fetch('/api/visit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-PDF-Studio': '1' },
  }).catch(() => {});
}
