import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import Admin from './app/admin';
import './app/globals.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname.replace(/\/+$/, '') === '/admin' ? <Admin /> : <Home />}</React.StrictMode>);


// Outside React effects so StrictMode does not double-count page loads.
if (window.location.pathname.replace(/\/+$/, '') !== '/admin') {
  void fetch('/api/visit', { method: 'POST', credentials: 'same-origin',
    headers: { 'X-PDF-Studio': '1' } }).catch(() => {});
}
