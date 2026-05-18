import React, { type ErrorInfo, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ConsentProvider } from './contexts/ConsentContext'
import AppMetadataManager from './components/seo/AppMetadataManager'
import AnalyticsRouteTracker from './components/analytics/AnalyticsRouteTracker'
import CookieConsentBanner from './components/public/CookieConsentBanner'
import RouteViewportManager from './components/router/RouteViewportManager'
import { installDesktopTrackerCompatibilityMarkers } from './lib/desktopTrackerCompatibility'
import './index.css'

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
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}

function RuntimeGuard({ children }: { children: React.ReactNode }) {
  const [fatalError, setFatalError] = useState<string | null>(null)

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.error?.message || event.message || 'Unknown runtime error'
      console.error('[root] runtime error', event.error || event.message)
      setFatalError(message)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason?.message || String(reason || 'Unhandled promise rejection')
      console.error('[root] unhandled rejection', reason)
      setFatalError(message)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  if (fatalError) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">App crashed at runtime</h1>
          <p className="mt-2 text-sm text-slate-700">An unhandled runtime error occurred after startup.</p>
          <p className="mt-4 rounded-md bg-slate-100 p-3 font-mono text-xs text-slate-800">{fatalError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

installDesktopTrackerCompatibilityMarkers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <RuntimeGuard>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter future={routerFuture}>
            <ConsentProvider>
              <AuthProvider>
                <RouteViewportManager />
                <AppMetadataManager />
                <AnalyticsRouteTracker />
                <CookieConsentBanner />
                <App />
              </AuthProvider>
            </ConsentProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </RuntimeGuard>
    </RootErrorBoundary>
  </React.StrictMode>,
)
