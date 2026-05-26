import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { selfieApi, userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { MapPin } from 'lucide-react';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface SelfieItem {
  id: number;
  user: { id: number; name: string } | null;
  image_url: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  attendance_date: string;
  created_at: string;
}

export default function SelfieMapView() {
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [selfies, setSelfies] = useState<SelfieItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxUser, setLightboxUser] = useState<string>('');

  const fetchSelfies = async () => {
    setLoading(true);
    try {
      const params: any = { start_date: startDate, end_date: endDate };
      if (selectedUserId) params.user_id = selectedUserId;
      const res = await selfieApi.mapData(params);
      const data = (res.data.data || []).map((item) => ({
        ...item,
        image_url: resolveMediaUrl(item.image_url),
      }));
      setSelfies(data);
      updateMapMarkers(data);
    } catch {
      setSelfies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    userApi.getAll({ period: 'all' }).then((res) => {
      setEmployees(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchSelfies();
  }, [startDate, endDate, selectedUserId]);

  const updateMapMarkers = (items: SelfieItem[]) => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const valid = items.filter((s) => s.latitude != null && s.longitude != null);

    if (valid.length === 0) return;

    valid.forEach((s) => {
      const marker = L.marker([s.latitude!, s.longitude!]).addTo(map);
      const popupImageUrl = (s.image_url || '').replace(/'/g, "\\'");
      const popupUserName = (s.user?.name || 'Unknown').replace(/'/g, "\\'");
      const popupContent = `
        <div style="min-width:180px;text-align:center;">
          <img src="${popupImageUrl}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;cursor:pointer;"
               onclick="(function(){var img=document.getElementById('lightbox-img');if(img){img.setAttribute('src','${popupImageUrl}');}var name=document.getElementById('lightbox-name');if(name){name.textContent='${popupUserName}';}var lightbox=document.getElementById('lightbox');if(lightbox){lightbox.classList.remove('hidden');}})();" />
          <p style="font-weight:600;font-size:13px;margin:0;">${s.user?.name || 'Unknown'}</p>
          <p style="font-size:11px;color:#64748b;margin:2px 0;">${s.attendance_date}</p>
          <p style="font-size:10px;color:#94a3b8;margin:0;">${s.latitude?.toFixed(6)}, ${s.longitude?.toFixed(6)}</p>
        </div>
      `;
      marker.bindPopup(popupContent);
      markersRef.current.push(marker);
    });

    const group = L.featureGroup(markersRef.current);
    map.fitBounds(group.getBounds().pad(0.1));
  };

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <PageHeader
        title="Employee Selfies Map"
        description="View selfie locations on a map"
      />

      {/* Filters */}
      <SurfaceCard>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Employee</label>
            <EmployeeSelect
              employees={employees}
              value={selectedUserId}
              onChange={setSelectedUserId}
              includeAllOption
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
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
          <span className="text-xs text-slate-400 ml-auto">
            {selfies.length} selfie{selfies.length !== 1 ? 's' : ''}
          </span>
        </div>
      </SurfaceCard>

      {/* Map */}
      <SurfaceCard>
        <div ref={mapRef} className="h-[500px] w-full rounded-lg border border-slate-200 z-0" />
      </SurfaceCard>

      {/* List */}
      <SurfaceCard>
        <div className="p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Selfie List</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : selfies.length === 0 ? (
            <p className="text-sm text-slate-400">No selfies found for the selected period.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {selfies.map((s) => (
                <div key={s.id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <img
                    src={s.image_url}
                    alt="Selfie"
                    className="w-full h-24 object-cover cursor-pointer hover:opacity-80"
                    onClick={() => {
                      setLightboxUrl(s.image_url);
                      setLightboxUser(s.user?.name || 'Unknown');
                    }}
                  />
                  <div className="p-2 text-xs">
                    <p className="font-medium text-slate-700 truncate">{s.user?.name}</p>
                    <p className="text-slate-400">{s.attendance_date}</p>
                    {s.latitude && (
                      <p className="text-slate-400 truncate">
                        {s.latitude.toFixed(4)}, {s.longitude?.toFixed(4)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Lightbox */}
      <div
        id="lightbox"
        className={`fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 ${lightboxUrl ? '' : 'hidden'}`}
        onClick={() => setLightboxUrl(null)}
      >
        <div className="max-w-lg max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
          <img id="lightbox-img" src={lightboxUrl || ''} alt="Selfie full" className="max-w-full max-h-[70vh] rounded-lg shadow-2xl" />
          <p id="lightbox-name" className="text-white text-center mt-2 font-medium">{lightboxUser}</p>
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white text-2xl hover:text-slate-300"
          >
            &times;
          </button>
        </div>
      </div>
      {/* Hidden elements for popup lightbox triggers */}
      <div className="hidden">
        <img id="lightbox-img" alt="" />
        <span id="lightbox-name" />
      </div>
    </div>
  );
}
