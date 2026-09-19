import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const PRELOAD_RELOAD_KEY = 'jobscan_preload_reload';

// Recover once when a browser still references a chunk from an older deploy.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  window.location.reload();
});

// Register service worker for production PWA support with loop-safe reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    const lastReload = parseInt(sessionStorage.getItem('sitetactix_sw_reload_ts') || '0', 10);
    const now = Date.now();
    // Prevent reload loops: only reload if at least 5 seconds have passed since last reload
    if (now - lastReload < 5000) return;
    
    refreshing = true;
    sessionStorage.setItem('sitetactix_sw_reload_ts', String(now));
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update();
        console.log('Service Worker registered successfully:', reg.scope);

        // Check for updates on foreground resume (app switch / tab focus)
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            const now = Date.now();
            // Throttle foreground checks to at most once every 30 seconds
            if (now - lastCheck > 30000) {
              lastCheck = now;
              reg.update().catch(() => {});
            }
          }
        });
      })
      .catch(err => console.error('Service Worker registration failed:', err));

    setTimeout(() => sessionStorage.removeItem(PRELOAD_RELOAD_KEY), 5000);
  });
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('[App Critical Error Caught]:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090b', color: '#f4f4f5', padding: '24px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '26px' }}>⚠️</div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px', color: '#fff' }}>Application Display Notice</h1>
          <p style={{ fontSize: '0.85rem', color: '#a1a1aa', maxWidth: '460px', marginBottom: '16px', lineHeight: '1.5' }}>
            {this.state.error?.message || 'A temporary display error occurred while rendering the page.'}
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: '10px 18px', backgroundColor: '#F1D7A7', color: '#171512', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Reload Page
            </button>
            <button
              type="button"
              onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload(); }}
              style={{ padding: '10px 18px', backgroundColor: '#27272a', color: '#e4e4e7', fontWeight: 600, borderRadius: '8px', border: '1px solid #3f3f46', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Clear Cache & Reset
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

