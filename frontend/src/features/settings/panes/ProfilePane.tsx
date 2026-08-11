import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { resolveUserRoleLabel } from '@/lib/permissions';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';
import MyAssetsCard from '@/components/assets/MyAssetsCard';
import SettingsCard from '../components/SettingsCard';
import CompletenessRing from '../components/CompletenessRing';
import ImageDropzone from '../components/ImageDropzone';
import type { PersonalDetailsForm } from '../types';
import type { SettingsController } from '../useSettingsController';

/** The thirteen personal fields, grouped by what a person is actually telling us. */
const GROUPS: Array<{
  id: string;
  title: string;
  description: string;
  fields: Array<keyof PersonalDetailsForm>;
  columns: string;
}> = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'Matches what payroll and statutory filings use.',
    fields: ['first_name', 'last_name', 'gender', 'date_of_birth'],
    columns: 'sm:grid-cols-2 xl:grid-cols-4',
  },
  {
    id: 'contact',
    title: 'Contact',
    description: 'Used when HR needs to reach you outside the app.',
    fields: ['phone', 'personal_email'],
    columns: 'sm:grid-cols-2',
  },
  {
    id: 'address',
    title: 'Address',
    description: 'Your state decides professional tax, so keep it current.',
    fields: ['address_line', 'city', 'state', 'postal_code'],
    columns: 'sm:grid-cols-2 xl:grid-cols-4',
  },
  {
    id: 'emergency',
    title: 'Emergency contact',
    description: 'The one thing HR cannot improvise. Three fields, two minutes.',
    fields: ['emergency_contact_name', 'emergency_contact_number', 'emergency_contact_relationship'],
    columns: 'sm:grid-cols-3',
  },
];

const FIELD_LABELS: Record<keyof PersonalDetailsForm, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  phone: 'Phone',
  personal_email: 'Personal email',
  address_line: 'Address line',
  city: 'City',
  state: 'State',
  postal_code: 'PIN code',
  emergency_contact_name: 'Name',
  emergency_contact_number: 'Phone',
  emergency_contact_relationship: 'Relationship',
};

const FIELD_PLACEHOLDERS: Partial<Record<keyof PersonalDetailsForm, string>> = {
  personal_email: 'you@personal.com',
  address_line: 'Flat, street, area',
  postal_code: '560038',
  emergency_contact_name: 'Who should we call?',
  emergency_contact_number: '+91 …',
  emergency_contact_relationship: 'Parent, spouse, friend…',
};

const PERSONAL_FIELD_ORDER = GROUPS.flatMap((group) => group.fields);

export default function ProfilePane({ controller }: { controller: SettingsController }) {
  const {
    user,
    organization,
    canEditEmail,
    profileName,
    setProfileName,
    profileEmail,
    setProfileEmail,
    profileAvatarPreview,
    applyAvatarFile,
    personalDetailsForm,
    setPersonalDetailsForm,
    isLoadingPersonalDetails,
    timezone,
    setTimezone,
    fieldErrors,
  } = controller;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const localTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(now);
    } catch {
      return null;
    }
  }, [now, timezone]);

  const filledCount = PERSONAL_FIELD_ORDER.filter((key) => String(personalDetailsForm[key] || '').trim()).length;

  const jumpToFirstGap = () => {
    const gap = PERSONAL_FIELD_ORDER.find((key) => !String(personalDetailsForm[key] || '').trim());
    if (!gap) {
      return;
    }
    const container = document.querySelector<HTMLElement>(`[data-field="${gap}"]`);
    container?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    container?.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
  };

  const setField = (key: keyof PersonalDetailsForm, value: string) => {
    setPersonalDetailsForm((current) => ({ ...current, [key]: value }));
  };

  const renderField = (key: keyof PersonalDetailsForm) => {
    const value = personalDetailsForm[key];
    const isEmpty = !String(value || '').trim();
    const errors = fieldErrors[key];

    return (
      <div key={key} data-field={key}>
        <FieldLabel>{FIELD_LABELS[key]}</FieldLabel>
        {key === 'gender' ? (
          <SelectInput value={value} onChange={(event) => setField(key, event.target.value)}>
            <option value="">Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </SelectInput>
        ) : key === 'date_of_birth' ? (
          <TextInput type="date" value={value} onChange={(event) => setField(key, event.target.value)} />
        ) : key.includes('phone') || key.includes('number') ? (
          <TextInput
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={FIELD_PLACEHOLDERS[key]}
            value={value}
            onChange={(event) => {
              // Only allow numbers, spaces, dashes, and plus sign
              setField(key, event.target.value.replace(/[^0-9\s\-+]/g, ''));
            }}
            className={isEmpty ? 'border-dashed' : undefined}
          />
        ) : key.includes('email') ? (
          <TextInput
            type="email"
            placeholder={FIELD_PLACEHOLDERS[key]}
            value={value}
            onChange={(event) => setField(key, event.target.value)}
            className={isEmpty ? 'border-dashed' : undefined}
          />
        ) : (
          <TextInput
            type="text"
            placeholder={FIELD_PLACEHOLDERS[key]}
            value={value}
            onChange={(event) => setField(key, event.target.value)}
            className={isEmpty ? 'border-dashed' : undefined}
          />
        )}
        {errors?.map((message) => (
          <p key={message} className="mt-1 text-xs text-red-600">{message}</p>
        ))}
      </div>
    );
  };

  const emergencyIsEmpty = GROUPS[3].fields.every((key) => !String(personalDetailsForm[key] || '').trim());

  return (
    <div className="space-y-4">
      <SettingsCard>
        <div className="flex flex-wrap items-center gap-5">
          <ImageDropzone
            preview={profileAvatarPreview}
            fallback={(profileName || user?.name || '?').charAt(0).toUpperCase()}
            onFile={applyAvatarFile}
            label="Profile photo"
            hint="Click or drop a picture here. PNG or JPG, up to 2MB."
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-slate-900">{profileName || user?.name}</p>
            <p className="truncate text-xs text-slate-600">{profileEmail || user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">{resolveUserRoleLabel(user)}</StatusBadge>
              {organization?.name ? <StatusBadge tone="neutral">{organization.name}</StatusBadge> : null}
            </div>
          </div>
          <CompletenessRing filled={filledCount} total={PERSONAL_FIELD_ORDER.length} onJump={jumpToFirstGap} />
        </div>
      </SettingsCard>

      <SettingsCard title="Account">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <FieldLabel>Full name</FieldLabel>
            <TextInput type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          </div>
          <div>
            <FieldLabel>Work email</FieldLabel>
            <TextInput
              type="email"
              value={profileEmail}
              onChange={(event) => setProfileEmail(event.target.value)}
              disabled={!canEditEmail}
            />
            {!canEditEmail ? (
              <p className="mt-1.5 text-xs text-slate-600">Only admins can change their own email here.</p>
            ) : null}
          </div>
          <div>
            <FieldLabel>Role</FieldLabel>
            <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-surface-sunken px-3.5">
              <StatusBadge tone="info">{resolveUserRoleLabel(user)}</StatusBadge>
            </div>
            <p className="mt-1.5 text-xs text-slate-600">Set by your workspace owner.</p>
          </div>
        </div>
      </SettingsCard>

      {isLoadingPersonalDetails ? (
        <SettingsCard title="Personal details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="animate-pulse">
                <div className="mb-2 h-3 w-20 rounded bg-slate-200" />
                <div className="h-11 rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        </SettingsCard>
      ) : (
        GROUPS.map((group) => (
          <SettingsCard
            key={group.id}
            id={`profile-${group.id}`}
            title={group.title}
            description={group.description}
            aside={
              group.id === 'emergency' && emergencyIsEmpty ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  Not set
                </span>
              ) : null
            }
          >
            <div className={`grid grid-cols-1 gap-4 ${group.columns}`}>
              {group.fields.map(renderField)}
            </div>
          </SettingsCard>
        ))
      )}

      <SettingsCard title="Working preferences" description="Attendance windows and reminders are computed in this zone.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Your timezone</FieldLabel>
            <SelectInput value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {Array.from(new Set([...COMMON_TIMEZONES, timezone])).map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </SelectInput>
            {localTime ? (
              <p className="mt-1.5 text-xs text-slate-600">
                It is <span className="font-semibold text-slate-900">{localTime}</span> there right now.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <MyAssetsCard userId={user?.id} />
    </div>
  );
}
