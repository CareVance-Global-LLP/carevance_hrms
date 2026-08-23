import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Plus, WifiOff } from 'lucide-react';
import { biometricDeviceApi, userApi } from '@/services/api';
import type { BiometricDevice } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';

/**
 * The punch terminals on the wall, and whose finger is whose.
 *
 * Two things go wrong with these integrations and both are surfaced here rather
 * than left to be discovered:
 *
 * A device that stops talking produces no attendance, which looks exactly like
 * everybody being absent — so a quiet device is called out, not just listed.
 *
 * And an unclaimed device id is the single most common reason attendance
 * silently does not appear: somebody enrolled on the terminal before an admin
 * said who they are. Those punches are kept, so claiming the id recovers the
 * backlog rather than starting from today.
 */
export default function BiometricDevicesPane() {
  const queryClient = useQueryClient();
  // One stable prefix per form, so every caption is tied to its control.
  // FieldLabel without htmlFor is decoration: a screen reader reaches the
  // field and announces "edit text, blank".
  const fieldId = useId();
  const [draft, setDraft] = useState<Partial<BiometricDevice> | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const devicesQuery = useQuery({
    queryKey: ['biometric-devices'],
    queryFn: async () => (await biometricDeviceApi.list()).data,
  });

  const employeesQuery = useQuery({
    queryKey: ['biometric-claim-employees'],
    queryFn: async () => (await userApi.getAll({ simple: 1 })).data,
    enabled: claiming !== null,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['biometric-devices'] });

  const save = useMutation({
    mutationFn: (device: Partial<BiometricDevice>) =>
      device.id ? biometricDeviceApi.update(device.id, device) : biometricDeviceApi.create(device),
    onSuccess: () => {
      setDraft(null);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not save this device.'),
  });

  const claim = useMutation({
    mutationFn: ({ deviceUserId, userId }: { deviceUserId: string; userId: number }) =>
      biometricDeviceApi.claim(deviceUserId, userId),
    onSuccess: (response) => {
      setClaiming(null);
      setError('');
      // The server says how much history was recovered; that is the useful
      // part, so show it rather than a generic "saved".
      setMessage(response.data.message);
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not save that mapping.'),
  });

  if (devicesQuery.isLoading) {
    return <PageLoadingState label="Loading devices..." />;
  }

  const devices = devicesQuery.data?.data ?? [];
  const unmapped = devicesQuery.data?.unmapped ?? [];
  const endpoint = devicesQuery.data?.endpoint ?? '';

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}

      {/* The one thing an installer needs, and the thing they will ask for. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Server URL for the device</p>
        <p className="mt-1 break-all font-mono text-sm text-slate-900">{endpoint}</p>
        <p className="mt-1.5 text-xs text-slate-600">
          Set this as the ADMS or cloud server address on the terminal, then add its serial number below. The device
          connects outward, so nothing needs opening on your network.
        </p>
      </div>

      {unmapped.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            {unmapped.length} device {unmapped.length === 1 ? 'ID is' : 'IDs are'} punching but not linked to anyone
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Their punches are being kept. Link each one and the earlier punches become attendance on the next run.
          </p>

          <div className="mt-2 space-y-2">
            {unmapped.map((row) => (
              <div key={row.device_user_id} className="rounded border border-amber-200 bg-surface-card p-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-medium text-slate-900">ID {row.device_user_id}</span>
                  <span className="text-xs text-slate-600 tabular-nums">
                    {plural(row.punch_count, 'punch', 'punches')} · since {new Date(row.first_seen).toLocaleDateString()}
                  </span>
                  {claiming !== row.device_user_id ? (
                    <Button
                      className="ml-auto"
                      variant="secondary"
                      size="sm"
                      onClick={() => setClaiming(row.device_user_id)}
                    >
                      Link to employee
                    </Button>
                  ) : null}
                </div>

                {claiming === row.device_user_id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-[14rem] flex-1">
                      <FieldLabel htmlFor={`${fieldId}-employee`}>Employee</FieldLabel>
                      <SelectInput
                        id={`${fieldId}-employee`}
                        defaultValue=""
                        onChange={(event) =>
                          event.target.value &&
                          claim.mutate({ deviceUserId: row.device_user_id, userId: Number(event.target.value) })
                        }
                      >
                        <option value="">
                          {employeesQuery.isLoading ? 'Loading…' : 'Choose an employee'}
                        </option>
                        {(employeesQuery.data ?? []).map((employee: any) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name} — {employee.email}
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setClaiming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {devices.map((device) => (
          <div key={device.id} className="rounded-lg border border-slate-200 bg-surface-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Fingerprint className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="font-medium text-slate-950">{device.name}</span>
              <span className="font-mono text-[11px] text-slate-500">{device.serial_number}</span>
              {device.is_stale ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                  <WifiOff className="h-3 w-3" /> Not reporting
                </span>
              ) : device.has_ever_reported === false ? (
                /*
                 * A third state, and a calm one. Between an admin adding the
                 * serial and an engineer pointing the terminal at us, a device
                 * has simply not called yet — which is not the same as one that
                 * called for a year and stopped.
                 */
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Waiting for first contact
                </span>
              ) : null}
              <span className="ml-auto text-xs text-slate-500 tabular-nums">
                {plural(device.punches_received ?? 0, 'punch', 'punches')}
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-600">
              {device.location || 'No location set'}
              {' · '}
              {device.last_seen_at
                ? `last heard from ${new Date(device.last_seen_at).toLocaleString()}`
                : 'never connected'}
            </p>

            {device.is_stale ? (
              <p className="mt-1 text-xs text-amber-700">
                {/* Said plainly, because the symptom is indistinguishable from
                    a genuinely empty office. */}
                No attendance is arriving from this device. Check it is powered on and still pointed at the server URL above.
              </p>
            ) : device.has_ever_reported === false ? (
              <p className="mt-1 text-xs text-slate-600">
                Set the server URL above on the terminal. It will appear here as soon as it calls in.
              </p>
            ) : null}

            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => setDraft(device)}>
                Edit
              </Button>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <form
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${fieldId}-name`}>Device name</FieldLabel>
              <TextInput
                id={`${fieldId}-name`}
                value={draft.name ?? ''}
                placeholder="Reception"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-serial`}>Serial number</FieldLabel>
              <TextInput
                id={`${fieldId}-serial`}
                value={draft.serial_number ?? ''}
                // Immutable: it is how the device identifies itself on every
                // request, and every punch already received references it.
                disabled={Boolean(draft.id)}
                onChange={(event) => setDraft({ ...draft, serial_number: event.target.value.trim() })}
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">Printed on the device, or under Device Info on its menu.</p>
            </div>
            <div>
              <FieldLabel htmlFor={`${fieldId}-location`}>Location</FieldLabel>
              <TextInput
                id={`${fieldId}-location`}
                value={draft.location ?? ''}
                placeholder="Ground floor entrance"
                onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save device'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setDraft({ name: '', serial_number: '' })}>
          Add device
        </Button>
      )}
    </div>
  );
}

/** "1 punch", not "1 punches" — the count of one is the common case here. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
