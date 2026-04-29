import { describe, expect, it } from 'vitest'
import {
  DESKTOP_TRACKER_COMPATIBILITY_MARKERS,
  installDesktopTrackerCompatibilityMarkers,
} from '@/lib/desktopTrackerCompatibility'

describe('desktopTrackerCompatibility', () => {
  it('publishes the required desktop tracker compatibility markers on window', () => {
    delete window.__CAREVANCE_DESKTOP_TRACKER_COMPAT__

    installDesktopTrackerCompatibilityMarkers()

    expect(window.__CAREVANCE_DESKTOP_TRACKER_COMPAT__).toEqual(DESKTOP_TRACKER_COMPATIBILITY_MARKERS)
  })
})
