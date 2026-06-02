import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './lib/globalErrorHandlers'

// fix-87: install window-level error/unhandledrejection capture BEFORE any
// app code runs so we don't lose the first paint's exceptions. The
// ErrorBoundary wraps App so React-render crashes also hit bp_log_error
// and the user sees a fallback instead of a blank screen.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
