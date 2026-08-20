import React, { type ErrorInfo, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ConsentProvider } from './contexts/ConsentContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AppMetadataManager from './components/seo/AppMetadataManager'
import AnalyticsRouteTracker from './components/analytics/AnalyticsRouteTracker'
import CookieConsentBanner from './components/public/CookieConsentBanner'
import RouteViewportManager from './components/router/RouteViewportManager'
import { ToastProvider } from './components/ui/Toast'
import { installDesktopTrackerCompatibilityMarkers } from './lib/desktopTrackerCompatibility'
import './index.css'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const isGoogleOAuthEnabled = import.meta.env.VITE_GOOGLE_OAUTH_ENABLED === 'true' && googleClientId

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
    },
    mutations: {
      retry: 0,
    },
  },
})

type RootErrorBoundaryProps = {
  children: React.ReactNode
}

type RootErrorBoundaryState = {
  error: Error | null
}

class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[root] render error', {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo.componentStack,
    })
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">App crashed while rendering</h1>
          <p className="mt-2 text-sm text-slate-700">The desktop shell stayed open, but the React app threw an error.</p>
          <p className="mt-4 rounded-md bg-slate-100 p-3 font-mono text-xs text-slate-800">
            {this.state.error.message || 'Unknown render error'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-surface-inverse px-4 py-2 text-sm font-medium text-on-inverse"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}

/**
 * Reports uncaught runtime errors. Deliberately does NOT unmount the app.
 *
 * This used to replace the entire application with a crash screen on any
 * window `error` or `unhandledrejection`. That sounds cautious and is the
 * opposite: an aborted fetch on navigation, a browser extension, a stray
 * rejection from a third-party script — none of which affect a working page —
 * all produced a full-screen "App crashed at runtime" with the raw message
 * shown to the user, and threw away whatever they were doing.
 *
 * Genuine render failures are caught by RootErrorBoundary above and by
 * RouteErrorBoundary per page, which are the mechanisms that can actually tell
 * a broken UI from a noisy one. This just makes sure nothing is silent.
 */
function RuntimeGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error('[root] runtime error', event.error || event.message)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[root] unhandled rejection', event.reason)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return <>{children}</>
}

installDesktopTrackerCompatibilityMarkers()

function AppProviders({ children }: { children: React.ReactNode }) {
  const appContent = (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter future={routerFuture}>
            <ConsentProvider>
              <AuthProvider>
                <RouteViewportManager />
                <AppMetadataManager />
                <AnalyticsRouteTracker />
                <CookieConsentBanner />
                {children}
              </AuthProvider>
            </ConsentProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )

  // Wrap with GoogleOAuthProvider only if enabled and configured
  if (isGoogleOAuthEnabled) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        {appContent}
      </GoogleOAuthProvider>
    )
  }

  return appContent
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <RuntimeGuard>
        <AppProviders>
          <App />
        </AppProviders>
      </RuntimeGuard>
    </RootErrorBoundary>
  </React.StrictMode>,
)
