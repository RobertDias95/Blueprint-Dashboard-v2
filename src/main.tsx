import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './lib/globalErrorHandlers'
import { registerAppServiceWorker } from './lib/serviceWorker'

// fix-87: install window-level error/unhandledrejection capture BEFORE any
// app code runs so we don't lose the first paint's exceptions. The
// ErrorBoundary wraps App so React-render crashes also hit bp_log_error
// and the user sees a fallback instead of a blank screen.
installGlobalErrorHandlers();

// ★★★ fix-369: REGISTERING A WORKER IS NOT ASKING FOR ANYTHING.
//
// This is the one piece of the notification stack that belongs on load, and it
// is safe there precisely because it prompts nobody: a registration raises no
// dialog, grants no capability and shows no banner. Notification PERMISSION is
// requested from a control the person clicks, never here — see
// components/DesktopAlertsControl for why that distinction is the whole game.
void registerAppServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
