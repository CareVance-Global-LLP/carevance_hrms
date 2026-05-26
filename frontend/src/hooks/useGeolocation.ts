import { useCallback, useEffect, useRef, useState } from 'react';

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  error: string | null;
  isInsideZone: boolean;
  loading: boolean;
}

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const earthRadius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useGeolocation(
  zoneLat?: number | null,
  zoneLng?: number | null,
  radiusMeters: number = 100
): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    error: null,
    isInsideZone: true,
    loading: true,
  });
  const watchIdRef = useRef<number | null>(null);

  const updatePosition = useCallback(
    (lat: number, lng: number, acc: number | null) => {
      setState((prev) => {
        const isInside =
          zoneLat != null && zoneLng != null
            ? haversineDistance(lat, lng, zoneLat, zoneLng) <= radiusMeters
            : true;

        return {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          error: null,
          isInsideZone: isInside,
          loading: false,
        };
      });
    },
    [zoneLat, zoneLng, radiusMeters]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation not supported',
        loading: false,
      }));
      return;
    }

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updatePosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy
        );
      },
      (err) => {
        setState((prev) => ({
          ...prev,
          error: err.message,
          loading: false,
        }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );

    // Watch position continuously
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        updatePosition(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy
        );
      },
      (err) => {
        setState((prev) => ({
          ...prev,
          error: err.message,
        }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [updatePosition]);

  return state;
}
