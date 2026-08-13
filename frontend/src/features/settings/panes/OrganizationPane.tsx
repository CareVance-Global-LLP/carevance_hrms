import { useMemo, useState } from 'react';
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import SettingsCard from '../components/SettingsCard';
import SegmentedControl from '../components/SegmentedControl';
import {
  IDLE_AUTO_STOP_OPTIONS,
  IDLE_RESOLUTION_POLICY_OPTIONS,
  IDLE_TRACK_OPTIONS,
  LOCK_AUTO_STOP_OPTIONS,
  validateIdleThresholds,
} from '../idlePolicy';
import ImageDropzone from '../components/ImageDropzone';
import BreakTypesSection from './BreakTypesSection';
import type { SettingsController } from '../useSettingsController';

type OrgSection = 'identity' | 'workday' | 'leave' | 'breaks' | 'monitoring' | 'danger';

const SECTIONS: Array<{ id: OrgSection; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'workday', label: 'Workday' },
  { id: 'leave', label: 'Leave policy' },
  { id: 'breaks', label: 'Breaks' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'danger', label: 'Danger zone' },
];

const SWATCHES = ['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-sky-500'];

/** Minutes since midnight, or null when the input is empty or unparseable. */
const toMinutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const DAY_START = 6 * 60;
const DAY_END = 20 * 60;

const toPercent = (minutes: number) =>
  Math.min(100, Math.max(0, ((minutes - DAY_START) / (DAY_END - DAY_START)) * 100));

const formatClock = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

/**
 * Puts office start and the late mark on one line so the grace window between
 * them is visible. As two unrelated time inputs, nothing said they were related
 * at all, let alone how wide the gap was.
 */
function WorkdayTimeline({ start, late }: { start: string; late: string }) {
  const startMinutes = toMinutes(start);
  const lateMinutes = toMinutes(late);

  if (startMinutes === null && lateMinutes === null) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-surface-sunken text-xs text-slate-600">
        Set an office start time to see the grace window.
      </div>
    );
  }

  const startPercent = startMinutes === null ? null : toPercent(startMinutes);
  const latePercent = lateMinutes === null ? null : toPercent(lateMinutes);
  const graceMinutes = startMinutes !== null && lateMinutes !== null ? lateMinutes - startMinutes : null;

  return (
    <div>
      <div className="relative h-16 overflow-hidden rounded-lg border border-slate-200 bg-surface-sunken">
        <div className="absolute inset-x-0 top-9 h-0.5 bg-slate-200" />
        {startPercent !== null && latePercent !== null && latePercent > startPercent ? (
          <div
            className="absolute top-9 h-0.5 bg-amber-500"
            style={{ left: `${startPercent}%`, width: `${latePercent - startPercent}%` }}
          />
        ) : null}

        {startPercent !== null ? (
          <>
            <span
              className="absolute top-[30px] h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-blue-600 bg-surface-card"
              style={{ left: `${startPercent}%` }}
            />
            <span
              className="absolute top-2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] font-semibold text-slate-900"
              style={{ left: `${startPercent}%` }}
            >
              {formatClock(startMinutes as number)}
              <span className="block text-[10px] font-medium text-slate-600">starts</span>
            </span>
          </>
        ) : null}

        {latePercent !== null ? (
          <>
            <span
              className="absolute top-[30px] h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-amber-500 bg-surface-card"
              style={{ left: `${latePercent}%` }}
            />
            <span
              className="absolute bottom-2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] font-semibold text-slate-900"
              style={{ left: `${latePercent}%` }}
            >
              {formatClock(lateMinutes as number)}
              <span className="block text-[10px] font-medium text-slate-600">late after</span>
            </span>
          </>
        ) : null}
      </div>
      {graceMinutes !== null ? (
        <p className="mt-2 text-xs text-slate-600">
          {graceMinutes > 0
            ? `A ${graceMinutes}-minute grace window. Check-ins after ${formatClock(lateMinutes as number)} are flagged late, never blocked.`
            : 'The late mark is not after the start time, so every check-in counts as late.'}
        </p>
      ) : null}
    </div>
  );
}

export default function OrganizationPane({ controller }: { controller: SettingsController }) {
  const {
    organization,
    isOrgEditable,
    canEditTimezone,
    isStrictAdminUser,
    orgName,
    setOrgName,
    orgSlug,
    setOrgSlug,
    orgLogoPreview,
    applyOrganizationLogoFile,
    officeStartTime,
    setOfficeStartTime,
    lateAfterTime,
    setLateAfterTime,
    orgMonitoringInterval,
    setOrgMonitoringInterval,
    orgIdleTrackSeconds,
    setOrgIdleTrackSeconds,
    orgIdleAutoStopSeconds,
    setOrgIdleAutoStopSeconds,
    orgLockAutoStopSeconds,
    setOrgLockAutoStopSeconds,
    orgIdleResolutionPolicy,
    setOrgIdleResolutionPolicy,
    orgTimezone,
    setOrgTimezone,
    leaveCategories,
    updateLeaveCategory,
    addLeaveCategory,
    removeLeaveCategory,
    deleteConfirmText,
    setDeleteConfirmText,
    deleteOrganization,
    isDeletingOrg,
  } = controller;

  const [section, setSection] = useState<OrgSection>('identity');
  const canEditLeave = isOrgEditable && isStrictAdminUser;

  const leaveTotal = useMemo(
    () => leaveCategories.reduce((total, category) => total + (Number(category.annual_quota) || 0), 0),
    [leaveCategories]
  );

  const idleConflict = validateIdleThresholds(orgIdleTrackSeconds, orgIdleAutoStopSeconds);

  const capturesPerDay = orgMonitoringInterval
    ? Math.round(480 / Number(orgMonitoringInterval))
    : Math.round(480 / 10);

  if (!organization?.id) {
    return (
      <SettingsCard title="No organization found">
        <p className="text-sm leading-6 text-slate-600">
          Your account is not linked to an organization. Create a workspace to start using CareVance.
        </p>
        <Button className="mt-4" onClick={() => { window.location.href = '/signup-owner'; }}>
          Create workspace
        </Button>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto border-b border-slate-200 px-1 pb-3" role="tablist" aria-label="Organization sections">
        {SECTIONS.map((item) => {
          const isActive = item.id === section;
          const isDanger = item.id === 'danger';
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSection(item.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? isDanger
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-transparent text-slate-600 hover:bg-surface-sunken hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {section === 'identity' ? (
        <div className="space-y-4">
          <SettingsCard title="Workspace identity">
            <div className="flex flex-wrap items-start gap-6">
              <ImageDropzone
                preview={orgLogoPreview}
                fallback="Logo"
                shape="rounded"
                disabled={!isOrgEditable}
                onFile={applyOrganizationLogoFile}
                label="Company logo"
                hint="Click or drop your logo here. PNG or JPG, up to 2MB."
              />
              <div className="grid min-w-[16rem] flex-1 grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Organization name</FieldLabel>
                  <TextInput value={orgName} onChange={(event) => setOrgName(event.target.value)} disabled={!isOrgEditable} />
                </div>
                <div>
                  <FieldLabel>Workspace address</FieldLabel>
                  <TextInput value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} disabled={!isOrgEditable} />
                  <p className="mt-1.5 truncate text-xs text-slate-600">
                    app.carevance.com/<span className="font-semibold text-slate-900">{orgSlug || 'your-workspace'}</span>
                  </p>
                </div>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Organization timezone"
            description="Attendance, reports and payroll cut-offs are computed in this zone. Managers can also update this."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SelectInput value={orgTimezone} onChange={(event) => setOrgTimezone(event.target.value)} disabled={!canEditTimezone}>
                {Array.from(new Set([...COMMON_TIMEZONES, orgTimezone])).map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </SelectInput>
            </div>
          </SettingsCard>
        </div>
      ) : null}

      {section === 'workday' ? (
        <SettingsCard
          title="Working hours"
          description="People can check in earlier. Anyone arriving after the late mark is flagged in reports, never blocked."
        >
          <WorkdayTimeline start={officeStartTime} late={lateAfterTime} />
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Office start</FieldLabel>
              <TextInput
                type="time"
                value={officeStartTime}
                onChange={(event) => setOfficeStartTime(event.target.value)}
                disabled={!isOrgEditable}
              />
            </div>
            <div>
              <FieldLabel>Late after</FieldLabel>
              <TextInput
                type="time"
                value={lateAfterTime}
                onChange={(event) => setLateAfterTime(event.target.value)}
                disabled={!isOrgEditable}
              />
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {section === 'leave' ? (
        <SettingsCard
          title="Annual leave"
          description="Once a quota is used up, further days are tracked as unpaid automatically."
          aside={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <span className="tabular-nums">{leaveTotal}</span> days total
            </span>
          }
        >
          <div className="space-y-2">
            {leaveCategories.map((category, index) => (
              <div
                key={`${category.code || 'leave'}-${index}`}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3"
              >
                <span className={`h-9 w-2 shrink-0 rounded-full ${SWATCHES[index % SWATCHES.length]}`} aria-hidden="true" />
                <div className="min-w-[10rem] flex-1">
                  <FieldLabel>Name</FieldLabel>
                  <TextInput
                    value={category.name}
                    onChange={(event) => updateLeaveCategory(index, { name: event.target.value })}
                    disabled={!canEditLeave}
                  />
                </div>
                <div className="w-32">
                  <FieldLabel>Code</FieldLabel>
                  <TextInput
                    value={category.code}
                    onChange={(event) => updateLeaveCategory(index, { code: event.target.value })}
                    disabled={!canEditLeave}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <FieldLabel>Days per year</FieldLabel>
                  <div className="flex items-center overflow-hidden rounded-lg border border-border-strong bg-surface-card">
                    <button
                      type="button"
                      aria-label={`Decrease ${category.name} quota`}
                      disabled={!canEditLeave}
                      onClick={() =>
                        updateLeaveCategory(index, {
                          annual_quota: String(Math.max(0, (Number(category.annual_quota) || 0) - 1)),
                        })
                      }
                      className="flex h-11 w-9 items-center justify-center text-slate-600 transition hover:bg-surface-sunken hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={category.annual_quota}
                      onChange={(event) => updateLeaveCategory(index, { annual_quota: event.target.value })}
                      disabled={!canEditLeave}
                      aria-label={`${category.name} days per year`}
                      className="w-16 border-0 bg-transparent py-2.5 text-center text-sm font-semibold tabular-nums text-slate-900 outline-none disabled:text-slate-400"
                    />
                    <button
                      type="button"
                      aria-label={`Increase ${category.name} quota`}
                      disabled={!canEditLeave}
                      onClick={() =>
                        updateLeaveCategory(index, {
                          annual_quota: String((Number(category.annual_quota) || 0) + 1),
                        })
                      }
                      className="flex h-11 w-9 items-center justify-center text-slate-600 transition hover:bg-surface-sunken hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {canEditLeave ? (
                  <button
                    type="button"
                    onClick={() => removeLeaveCategory(index)}
                    aria-label={`Remove ${category.name}`}
                    className="mb-1 rounded-md p-2 text-slate-500 transition hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {canEditLeave ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={addLeaveCategory}>
              Add leave type
            </Button>
          ) : (
            <p className="mt-3 text-xs text-slate-600">Only an admin can edit leave policy categories.</p>
          )}
        </SettingsCard>
      ) : null}

      {section === 'breaks' ? (
        isStrictAdminUser ? (
          <BreakTypesSection disabled={!isOrgEditable} />
        ) : (
          <SettingsCard title="Break types">
            <p className="text-sm text-slate-600">Only an admin can configure break types.</p>
          </SettingsCard>
        )
      ) : null}

      {section === 'monitoring' ? (
        isStrictAdminUser ? (
          <>
          <SettingsCard
            title="Screenshot interval"
            description="The organization default. Anyone with a personal override keeps it."
          >
            <SegmentedControl
              ariaLabel="Screenshot interval"
              disabled={!isOrgEditable}
              value={orgMonitoringInterval}
              onChange={setOrgMonitoringInterval}
              options={[
                { value: '', label: 'System default' },
                { value: '1', label: '1 min' },
                { value: '3', label: '3 min' },
                { value: '5', label: '5 min' },
                { value: '10', label: '10 min' },
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
              ]}
            />
            <p className="mt-3 max-w-2xl text-xs leading-5 text-slate-600">
              {orgMonitoringInterval
                ? <>About <span className="font-semibold text-slate-900 tabular-nums">{capturesPerDay}</span> screenshots per person over an eight-hour day.</>
                : <>No organization default, so everyone falls through to the system default of every 10 minutes — about <span className="font-semibold text-slate-900 tabular-nums">{capturesPerDay}</span> screenshots per person over an eight-hour day.</>}
              {' '}Lowering this multiplies capture for the whole organization at once, which is why it is admin-only.
            </p>
          </SettingsCard>

          <SettingsCard
            title="Idle and inactivity"
            description="When time away from the keyboard stops counting as work. Anyone with a personal override keeps it."
            className="mt-4"
          >
            <div className="space-y-5">
              <div>
                <FieldLabel>Mark as idle after</FieldLabel>
                <SegmentedControl
                  ariaLabel="Mark as idle after"
                  disabled={!isOrgEditable}
                  value={orgIdleTrackSeconds}
                  onChange={setOrgIdleTrackSeconds}
                  options={IDLE_TRACK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
                  Time with no keyboard or mouse input stops counting towards the app someone had open, and is
                  recorded as idle instead.
                </p>
              </div>

              <div>
                <FieldLabel>Stop the timer after</FieldLabel>
                <SegmentedControl
                  ariaLabel="Stop the timer after"
                  disabled={!isOrgEditable}
                  value={orgIdleAutoStopSeconds}
                  onChange={setOrgIdleAutoStopSeconds}
                  options={IDLE_AUTO_STOP_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
                  The timer stops on its own after this much inactivity. On their return the person is asked whether
                  to keep or discard the idle time — it is never deducted without an answer. Set this generously:
                  reading, a call and a whiteboard all look identical to a keyboard.
                </p>
              </div>

              <div>
                <FieldLabel>Stop when the screen is locked for</FieldLabel>
                <SegmentedControl
                  ariaLabel="Stop when the screen is locked for"
                  disabled={!isOrgEditable}
                  value={orgLockAutoStopSeconds}
                  onChange={setOrgLockAutoStopSeconds}
                  options={LOCK_AUTO_STOP_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
                  A locked screen is stronger evidence of stepping away than silence alone, so this can be shorter
                  than the idle threshold.
                </p>
              </div>


              <div>
                <FieldLabel>When someone comes back from being idle</FieldLabel>
                <SegmentedControl
                  ariaLabel="When someone comes back from being idle"
                  disabled={!isOrgEditable}
                  value={orgIdleResolutionPolicy}
                  onChange={setOrgIdleResolutionPolicy}
                  options={IDLE_RESOLUTION_POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
                <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
                  {orgIdleResolutionPolicy === 'prompt'
                    ? 'They are asked whether the time away was work, and nothing is added or removed until they answer. This is the default and what Hubstaff and Time Doctor do.'
                    : orgIdleResolutionPolicy === 'always_keep'
                      ? 'Idle time is counted as work automatically. Nobody is asked, and they are told it was kept.'
                      : 'Idle time is removed from the timesheet automatically. Nobody is asked, and they are told it was removed.'}
                </p>
              </div>

              {idleConflict ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {idleConflict}
                </p>
              ) : null}
            </div>
          </SettingsCard>
          </>
        ) : null
      ) : null}

      {section === 'danger' ? (
        isStrictAdminUser ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              Delete this organization
            </h3>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-700">
              This permanently removes {organization?.name || 'your organization'} and every user, project, task, time
              entry, payslip and screenshot inside it. There is no undo and no export afterwards.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder={`Type ${orgName || organization?.name || 'the organization name'} to confirm`}
                aria-label="Confirm organization name"
                className="min-h-11 min-w-[16rem] flex-1 rounded-lg border border-rose-300 bg-surface-card px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-300/30"
              />
              <Button
                variant="danger"
                onClick={deleteOrganization}
                loading={isDeletingOrg}
                disabled={isDeletingOrg || deleteConfirmText !== (orgName || organization?.name || '')}
                iconLeft={<Trash2 className="h-4 w-4" />}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null
      ) : null}

      {!isOrgEditable && section !== 'danger' ? (
        <p className="text-xs text-slate-600">Only an admin or manager can update organization settings.</p>
      ) : null}
    </div>
  );
}
