import React from 'react'
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

installDesktopTrackerCompatibilityMarkers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
