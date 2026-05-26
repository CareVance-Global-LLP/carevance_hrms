import { useEffect, useState } from 'react';
import { geofenceApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import GeofenceMapPicker from '@/components/geofence/GeofenceMapPicker';
import { AlertTriangle } from 'lucide-react';

interface Zone {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
}

export default function GeofenceSettings() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('100');
  const [isActive, setIsActive] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  const fetchZones = async () => {
    setLoading(true);
    try {
      const res = await geofenceApi.zones();
      setZones(res.data.data || []);
    } catch {
      setError('Failed to load zones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, []);

  const resetForm = () => {
    setName('');
    setLatitude('');
    setLongitude('');
    setRadiusMeters('100');
    setIsActive(true);
    setEditingId(null);
  };

  const handleEdit = (zone: Zone) => {
    setName(zone.name);
    setLatitude(String(zone.latitude));
    setLongitude(String(zone.longitude));
    setRadiusMeters(String(zone.radius_meters));
    setIsActive(zone.is_active);
    setEditingId(zone.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const payload = {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius_meters: parseInt(radiusMeters, 10),
        is_active: isActive,
      };

      if (editingId) {
        await geofenceApi.update(editingId, payload);
        setSuccess('Zone updated');
      } else {
        await geofenceApi.create(payload);
        setSuccess('Zone created');
      }

      resetForm();
      await fetchZones();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this geofence zone?')) return;
    setError(null);
    try {
      await geofenceApi.delete(id);
      setSuccess('Zone deleted');
      if (editingId === id) resetForm();
      await fetchZones();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to delete zone');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title="Geofence Zones"
        description="Define allowed locations for employee timer start"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto font-bold">&times;</button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
          {success}
          <button onClick={() => setSuccess(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      {/* Form */}
      <SurfaceCard>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">
            {editingId ? 'Edit Zone' : 'Create Zone'}
          </h2>

          <div>
            <FieldLabel>Zone Name</FieldLabel>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Head Office"
              required
            />
          </div>

          <GeofenceMapPicker
            latitude={latitude}
            longitude={longitude}
            radiusMeters={radiusMeters}
            onLatitudeChange={setLatitude}
            onLongitudeChange={setLongitude}
            onRadiusChange={setRadiusMeters}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-slate-300"
            />
            Active
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update Zone' : 'Create Zone'}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </SurfaceCard>

      {/* Zones List */}
      <SurfaceCard>
        <div className="p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Existing Zones</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : zones.length === 0 ? (
            <p className="text-sm text-slate-400">No zones defined yet.</p>
          ) : (
            <div className="space-y-3">
              {zones.map((zone) => (
                <div key={zone.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{zone.name}</p>
                    <p className="text-xs text-slate-500">
                      {zone.latitude}, {zone.longitude} &middot; {zone.radius_meters}m radius
                      &middot; {zone.is_active ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(zone)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(zone.id)}
                      className="text-xs text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
