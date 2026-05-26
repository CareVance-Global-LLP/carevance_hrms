import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface GeofenceMapPickerProps {
  latitude: string;
  longitude: string;
  radiusMeters: string;
  onLatitudeChange: (val: string) => void;
  onLongitudeChange: (val: string) => void;
  onRadiusChange: (val: string) => void;
}

// Fix Leaflet default icon paths (broken with bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

async function searchLocation(query: string): Promise<{ lat: number; lng: number; displayName: string }[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
  );
  const data = await res.json();
  return (data as any[]).map((item) => ({
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    displayName: item.display_name,
  }));
}

export default function GeofenceMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onLatitudeChange,
  onLongitudeChange,
  onRadiusChange,
}: GeofenceMapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ lat: number; lng: number; displayName: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const lat = parseFloat(latitude) || 28.6139;
  const lng = parseFloat(longitude) || 77.209;
  const radius = parseInt(radiusMeters) || 100;

  const updateMarkerAndCircle = (newLat: number, newLng: number, newRadius?: number) => {
    const r = newRadius ?? radius;
    if (markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
    }
    if (circleRef.current) {
      circleRef.current.setLatLng([newLat, newLng]);
      circleRef.current.setRadius(r);
    }
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([newLat, newLng], Math.max(12, mapInstanceRef.current.getZoom()));
    }
    onLatitudeChange(String(newLat));
    onLongitudeChange(String(newLng));
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onLatitudeChange(String(pos.lat.toFixed(7)));
      onLongitudeChange(String(pos.lng.toFixed(7)));
    });

    const circle = L.circle([lat, lng], {
      radius,
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
      weight: 2,
    }).addTo(map);

    markerRef.current = marker;
    circleRef.current = circle;
    mapInstanceRef.current = map;
    setMapReady(true);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Sync circle radius when radiusMeters prop changes
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(radius);
    }
  }, [radius]);

  // Sync marker position when lat/lng props change externally
  useEffect(() => {
    if (!markerRef.current || !circleRef.current || !mapInstanceRef.current) return;
    const current = markerRef.current.getLatLng();
    const newLat = parseFloat(latitude);
    const newLng = parseFloat(longitude);
    if (isNaN(newLat) || isNaN(newLng)) return;
    if (Math.abs(current.lat - newLat) > 0.000001 || Math.abs(current.lng - newLng) > 0.000001) {
      markerRef.current.setLatLng([newLat, newLng]);
      circleRef.current.setLatLng([newLat, newLng]);
      mapInstanceRef.current.setView([newLat, newLng], mapInstanceRef.current.getZoom());
    }
  }, [latitude, longitude]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchLocation(searchQuery.trim());
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSuggestion = (item: { lat: number; lng: number; displayName: string }) => {
    setSearchQuery(item.displayName);
    setSuggestions([]);
    updateMarkerAndCircle(item.lat, item.lng);
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateMarkerAndCircle(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
        // Reverse geocode to set search name
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`
        )
          .then((r) => r.json())
          .then((data) => {
            if (data?.display_name) setSearchQuery(data.display_name);
          })
          .catch(() => {});
      },
      () => setDetecting(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleMapClick = (e: L.LeafletMouseEvent) => {
    updateMarkerAndCircle(e.latlng.lat, e.latlng.lng);
  };

  // Attach map click handler once map is ready
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [mapReady]);

  return (
    <div className="space-y-3">
      {/* Search + Detect row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search office location..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          {searching && (
            <span className="absolute right-3 top-2.5 text-xs text-slate-400">Searching...</span>
          )}
          {suggestions.length > 0 && (
            <div className="absolute z-[1000] mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectSuggestion(s)}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-blue-50 border-b border-slate-100 last:border-0"
                >
                  {s.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDetectLocation}
          disabled={detecting}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {detecting ? 'Detecting...' : '📍 Detect'}
        </button>
      </div>

      {/* Map */}
      <div ref={mapRef} className="h-[400px] w-full rounded-lg border border-slate-200 z-0" />

      {/* Radius slider */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 shrink-0">Radius:</span>
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={Math.min(radius, 1000)}
          onChange={(e) => {
            const val = e.target.value;
            onRadiusChange(val);
            if (circleRef.current) {
              circleRef.current.setRadius(parseInt(val));
            }
          }}
          className="flex-1 accent-blue-600"
        />
        <span className="text-xs font-medium text-slate-700 w-16 text-right">{radius}m</span>
      </div>

      {/* Raw coordinates display */}
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
        <div>Lat: {parseFloat(latitude)?.toFixed(6) || '—'}</div>
        <div>Lng: {parseFloat(longitude)?.toFixed(6) || '—'}</div>
      </div>
    </div>
  );
}
