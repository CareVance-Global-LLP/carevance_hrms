export const DESKTOP_TRACKER_COMPATIBILITY_MARKERS = [
  'desktop-tracker:pending-sessions',
  'desktop-tracker:flush',
  'session_key',
  'started_at',
  'last_seen_at',
  'ended_at',
] as const

export const installDesktopTrackerCompatibilityMarkers = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.__CAREVANCE_DESKTOP_TRACKER_COMPAT__ = [...DESKTOP_TRACKER_COMPATIBILITY_MARKERS]
}
