import { cloneElement, isValidElement, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { settingsApi } from '@/services/api';
import { COMMON_TIMEZONES, DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { ONBOARDING_GROUPS, profileCompleteness } from '@/lib/employeeProfileFields';
import type { EmployeeProfileDetails } from '@/types';
import { brandLabel } from '@/config/brand';

type ProfileForm = {
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  phone: string;
  personal_email: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relationship: string;
  // Optional, unlike everything above. See OPTIONAL_FIELDS below.
  blood_group: string;
  permanent_address_line: string;
  permanent_city: string;
  permanent_state: string;
  permanent_postal_code: string;
};

/**
 * The fields a joiner may leave blank and still finish onboarding.
 *
 * Everything else on this form is required, and `isValid` used to be a blanket
 * "every value is non-empty" over the whole shape — so adding a field here
 * would silently have made it mandatory and blocked first login until the new
 * joiner produced a blood group and a permanent address. These are reported by
 * the completeness ring instead.
 */
const OPTIONAL_FIELDS: ReadonlyArray<keyof ProfileForm> = [
  'blood_group',
  'permanent_address_line',
  'permanent_city',
  'permanent_state',
  'permanent_postal_code',
];

/**
 * Human names for the fields, used in validation messages.
 *
 * "Emergency contact relationship is required" reads as an instruction;
 * "emergency_contact_relationship is required" reads as a stack trace.
 */
const FIELD_LABELS: Record<keyof ProfileForm, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  phone: 'Phone',
  personal_email: 'Personal email',
  address_line: 'Address line',
  city: 'City',
  state: 'State',
  postal_code: 'Postal code',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_number: 'Emergency contact number',
  emergency_contact_relationship: 'Emergency contact relationship',
  blood_group: 'Blood group',
  permanent_address_line: 'Permanent address line',
  permanent_city: 'Permanent city',
  permanent_state: 'Permanent state',
  permanent_postal_code: 'Permanent postal code',
};

const createEmptyForm = (): ProfileForm => ({
  first_name: '',
  last_name: '',
  gender: '',
  date_of_birth: '',
  phone: '',
  personal_email: '',
  address_line: '',
  city: '',
  state: '',
  postal_code: '',
  emergency_contact_name: '',
  emergency_contact_number: '',
  emergency_contact_relationship: '',
  blood_group: '',
  permanent_address_line: '',
  permanent_city: '',
  permanent_state: '',
  permanent_postal_code: '',
});

const normalizeProfile = (profile?: EmployeeProfileDetails | null): ProfileForm => ({
  first_name: String(profile?.first_name || ''),
  last_name: String(profile?.last_name || ''),
  gender: String(profile?.gender || ''),
  date_of_birth: String(profile?.date_of_birth || '').slice(0, 10),
  phone: String(profile?.phone || ''),
  personal_email: String(profile?.personal_email || ''),
  address_line: String(profile?.address_line || ''),
  city: String(profile?.city || ''),
  state: String(profile?.state || ''),
  postal_code: String(profile?.postal_code || ''),
  emergency_contact_name: String(profile?.emergency_contact_name || ''),
  emergency_contact_number: String(profile?.emergency_contact_number || ''),
  emergency_contact_relationship: String(profile?.emergency_contact_relationship || ''),
  blood_group: String((profile as any)?.blood_group || ''),
  permanent_address_line: String((profile as any)?.permanent_address_line || ''),
  permanent_city: String((profile as any)?.permanent_city || ''),
  permanent_state: String((profile as any)?.permanent_state || ''),
  permanent_postal_code: String((profile as any)?.permanent_postal_code || ''),
});

export default function ProfileOnboardingPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState<ProfileForm>(createEmptyForm());
  const [timezone, setTimezone] = useState(DEFAULT_APP_TIMEZONE);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  /*
   * Keyed by field name, exactly as Laravel's 422 `errors` object is, so a
   * server rule this page does not know about still lands on the right control
   * rather than becoming another unattributed banner.
   */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProfileForm, string[]>>>({});
  const meQuery = useQuery({
    queryKey: ['settings-me-onboarding'],
    queryFn: async () => (await settingsApi.me()).data,
  });

  useEffect(() => {
    const profile = meQuery.data?.employee_profile || user?.employee_profile;
    if (profile) {
      setForm(normalizeProfile(profile));
    }

    // Set timezone from user settings if available, fallback to browser detection
    const userTimezone = (user?.settings as any)?.timezone;
    if (userTimezone && COMMON_TIMEZONES.includes(userTimezone)) {
      setTimezone(userTimezone);
    } else {
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (COMMON_TIMEZONES.includes(browserTimezone)) {
        setTimezone(browserTimezone);
      }
    }

    if (user?.name) {
      const [firstName = '', ...rest] = String(user.name).trim().split(' ');
      setForm((current) => ({
        ...current,
        first_name: current.first_name || firstName,
        last_name: current.last_name || rest.join(' '),
        personal_email: current.personal_email || String(user.email || ''),
      }));
    }
  }, [meQuery.data?.employee_profile, user?.email, user?.employee_profile, user?.name, user?.settings]);

  /**
   * What the server actually enforces, mirrored so a joiner hears about it while
   * they are still looking at the field.
   *
   * Deliberately the same rules, not stricter ones: a client that refuses
   * something the API would accept is its own kind of dead end, and one that
   * accepts something the API refuses just moves the confusion later.
   *
   * `display_name` is absent on purpose. It is derived server-side from the
   * first and last name; requiring it here would recreate the bug this page had
   * — a required field with nowhere to type it.
   */
  const validateField = (key: keyof ProfileForm, value: string): string | null => {
    const trimmed = String(value ?? '').trim();

    if (!OPTIONAL_FIELDS.includes(key) && trimmed === '') {
      return `${FIELD_LABELS[key]} is required.`;
    }

    if (trimmed === '') {
      return null;
    }

    if (key === 'personal_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return 'Enter a valid email address, like name@example.com.';
    }

    if (key === 'date_of_birth') {
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return 'Enter a valid date.';
      }
      // Built from local parts rather than comparing to an ISO string, which
      // resolves against UTC and calls today "tomorrow" anywhere ahead of it.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (parsed > today) {
        return 'Date of birth cannot be in the future.';
      }
    }

    return null;
  };

  /** Validate one field as the joiner leaves it, and drop the error once fixed. */
  const handleBlur = (key: keyof ProfileForm) => {
    const message = validateField(key, form[key]);

    setFieldErrors((current) => {
      const next = { ...current };
      if (message) {
        next[key] = [message];
      } else {
        delete next[key];
      }
      return next;
    });
  };

  /**
   * One field, with its label and whatever is wrong with it.
   *
   * A function, not a component — a component declared inside the render body
   * is a fresh type each time, so React would remount it on every keystroke and
   * the input would lose focus as you typed.
   *
   * `data-field` is what scrollToField looks for, matching the convention
   * ProfilePane already uses.
   */
  const field = (
    key: keyof ProfileForm,
    label: string,
    control: ReactNode,
    className = ''
  ) => {
    const errors = fieldErrors[key];
    const controlId = `onboarding-${key}`;

    return (
      <div className={className} data-field={key}>
        {/*
          htmlFor matters here beyond tidiness. Not one of these eighteen labels
          was associated with its input, so a screen reader announced "edit
          text, blank" on every field of the form a new joiner meets first — and
          an error message pointing at "Personal email" named something the
          field itself never claimed to be.
        */}
        <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        {isValidElement(control)
          ? cloneElement(control as ReactElement<{ id?: string; 'aria-invalid'?: boolean }>, {
              id: controlId,
              'aria-invalid': errors?.length ? true : undefined,
            })
          : control}
        {errors?.length ? (
          <p id={`${controlId}-error`} className="mt-1 text-xs font-medium text-rose-600">
            {errors[0]}
          </p>
        ) : null}
      </div>
    );
  };

  const isValid = useMemo(
    () =>
      (Object.keys(form) as Array<keyof ProfileForm>)
        .filter((key) => !OPTIONAL_FIELDS.includes(key))
        .every((key) => String(form[key]).trim() !== ''),
    [form]
  );

  /*
   * Counted against the shared registry rather than the shape of this form, so
   * the percentage here and the "incomplete profiles" count on the Employees
   * page cannot disagree. Scoped to employee-owned fields: HR still has to
   * supply the employee code and joining date, and it would be wrong to tell a
   * new joiner they are incomplete because of something they cannot enter.
   */
  /*
   * Scoped to the groups this form renders, as well as to employee-owned
   * fields.
   *
   * The owner scope alone was not enough: PAN, Aadhaar and a bank account are
   * employee-owned too, and they are entered in Settings > Profile rather than
   * here — so they counted as missing and the bar could never reach 100% no
   * matter what the joiner typed. Telling a new starter they are incomplete
   * for something this page does not ask for is the thing the scope exists to
   * prevent.
   */
  const completeness = useMemo(
    () => profileCompleteness(
      { employee_profile: form },
      { owner: 'employee', group: ONBOARDING_GROUPS }
    ),
    [form]
  );
  const totalFields = completeness.total + 1; // +1 for timezone
  const completedFields = completeness.filled + (timezone ? 1 : 0);
  const progressPercentage = Math.round((completedFields / Math.max(1, totalFields)) * 100);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Save profile and timezone preferences
      const [profileRes, prefsRes] = await Promise.all([
        settingsApi.updateOnboardingProfile(form),
        settingsApi.updatePreferences({ timezone }),
      ]);
      return { profile: profileRes.data, preferences: prefsRes.data };
    },
      onSuccess: (response) => {
        updateUser(response.profile.user);
        setFeedback({ tone: 'success', message: 'Profile details saved successfully.' });
        navigate('/dashboard', { replace: true });
      },
    onError: (error: any) => {
      /*
       * Laravel puts the useful part in `errors`, keyed by field. Reading only
       * `message` is what produced "your data is invalid" with nothing to act
       * on — and in the case this page shipped with, the field named was not
       * even on the screen.
       */
      const apiErrors = error?.response?.data?.errors;

      if (apiErrors && typeof apiErrors === 'object') {
        const mapped: Partial<Record<keyof ProfileForm, string[]>> = {};
        let firstKey: keyof ProfileForm | null = null;

        Object.entries(apiErrors).forEach(([field, messages]) => {
          const key = field as keyof ProfileForm;
          mapped[key] = messages as string[];
          if (!firstKey) firstKey = key;
        });

        setFieldErrors(mapped);
        if (firstKey) scrollToField(firstKey);

        setFeedback({ tone: 'error', message: 'Please fix the highlighted fields.' });
        return;
      }

      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not save profile details.',
      });
    },
  });

  /** Bring the first problem into view; the banner alone can be off-screen. */
  const scrollToField = (key: keyof ProfileForm) => {
    if (typeof document === 'undefined') return;
    document
      .querySelector<HTMLElement>(`[data-field="${key}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** Check everything, and stop before a request we already know will fail. */
  const submitProfile = () => {
    const errors: Partial<Record<keyof ProfileForm, string[]>> = {};

    (Object.keys(form) as Array<keyof ProfileForm>).forEach((key) => {
      const message = validateField(key, form[key]);
      if (message) errors[key] = [message];
    });

    setFieldErrors(errors);

    const firstBad = (Object.keys(form) as Array<keyof ProfileForm>).find((key) => errors[key]);

    if (firstBad) {
      setFeedback({ tone: 'error', message: 'Please fix the highlighted fields.' });
      scrollToField(firstBad);
      return;
    }

    setFeedback(null);
    saveMutation.mutate();
  };

  const skipMutation = useMutation({
    mutationFn: async () => settingsApi.skipOnboardingProfile(),
    onSuccess: (response) => {
      updateUser(response.data.user);
      navigate('/dashboard', { replace: true });
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not skip profile setup right now.',
      });
    },
  });

  if (meQuery.isLoading) {
    return <PageLoadingState label="Loading profile setup..." />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Welcome to {brandLabel} Tracker</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Let&apos;s set up your profile details</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Fill your details now for a complete setup, or skip and continue to your dashboard.
            </p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">Completion</p>
            <p className="mt-1 text-xl font-semibold text-blue-900">{progressPercentage}%</p>
          </div>
        </div>

        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">{completedFields} of {totalFields} fields completed</p>
      </header>

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Basic Information</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {field('first_name', 'First Name', (
                  <TextInput
                    value={form.first_name}
                    onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                    onBlur={() => handleBlur('first_name')} required
                  />
                ))}
                {field('last_name', 'Last Name', (
                  <TextInput
                    value={form.last_name}
                    onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
                    onBlur={() => handleBlur('last_name')} required
                  />
                ))}
                {field('gender', 'Gender', (
                  <SelectInput
                    value={form.gender}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, gender: event.target.value }));
                      // A select has no meaningful blur, so it clears its own
                      // error the moment a value is picked.
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.gender;
                        return next;
                      });
                    }}
                    required
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </SelectInput>
                ))}
                {field('date_of_birth', 'Date of Birth', (
                  <TextInput
                    type="date" value={form.date_of_birth}
                    onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value }))}
                    onBlur={() => handleBlur('date_of_birth')} required
                  />
                ))}
                {field('phone', 'Phone', (
                  <TextInput
                    value={form.phone}
                    onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                    onBlur={() => handleBlur('phone')} required
                  />
                ))}
                {field('blood_group', 'Blood Group (optional)', (
                  <SelectInput value={form.blood_group} onChange={(event) => setForm((current) => ({ ...current, blood_group: event.target.value }))}>
                    <option value="">Select blood group</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </SelectInput>
                ))}
                {field('personal_email', 'Personal Email', (
                  <TextInput
                    type="email" value={form.personal_email}
                    onChange={(event) => setForm((current) => ({ ...current, personal_email: event.target.value }))}
                    onBlur={() => handleBlur('personal_email')} required
                  />
                ), 'md:col-span-2')}
              </div>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Address & Emergency Contact</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {field('address_line', 'Address Line', (
                  <TextInput
                    value={form.address_line}
                    onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))}
                    onBlur={() => handleBlur('address_line')} required
                  />
                ), 'md:col-span-2')}
                {field('city', 'City', (
                  <TextInput
                    value={form.city}
                    onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                    onBlur={() => handleBlur('city')} required
                  />
                ))}
                {field('state', 'State', (
                  <TextInput
                    value={form.state}
                    onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}
                    onBlur={() => handleBlur('state')} required
                  />
                ))}
                {field('postal_code', 'Postal Code', (
                  <TextInput
                    value={form.postal_code}
                    onChange={(event) => setForm((current) => ({ ...current, postal_code: event.target.value }))}
                    onBlur={() => handleBlur('postal_code')} required
                  />
                ))}
                {field('emergency_contact_name', 'Emergency Contact Name', (
                  <TextInput
                    value={form.emergency_contact_name}
                    onChange={(event) => setForm((current) => ({ ...current, emergency_contact_name: event.target.value }))}
                    onBlur={() => handleBlur('emergency_contact_name')} required
                  />
                ), 'md:col-span-2')}
                {field('emergency_contact_number', 'Emergency Contact Number', (
                  <TextInput
                    value={form.emergency_contact_number}
                    onChange={(event) => setForm((current) => ({ ...current, emergency_contact_number: event.target.value }))}
                    onBlur={() => handleBlur('emergency_contact_number')} required
                  />
                ))}
                {field('emergency_contact_relationship', 'Emergency Contact Relationship', (
                  <TextInput
                    value={form.emergency_contact_relationship}
                    onChange={(event) => setForm((current) => ({ ...current, emergency_contact_relationship: event.target.value }))}
                    onBlur={() => handleBlur('emergency_contact_relationship')} required
                  />
                ))}

                {/* Optional, and kept apart from the current address: this is
                    the one a PF nomination and bank KYC are registered
                    against, so it must not be overwritten by a move. */}
                <div className="md:col-span-2 border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Permanent Address (optional)</p>
                </div>
                {field('permanent_address_line', 'Address Line', (
                  <TextInput
                    value={form.permanent_address_line}
                    onChange={(event) => setForm((current) => ({ ...current, permanent_address_line: event.target.value }))}
                    onBlur={() => handleBlur('permanent_address_line')}
                  />
                ), 'md:col-span-2')}
                {field('permanent_city', 'City', (
                  <TextInput
                    value={form.permanent_city}
                    onChange={(event) => setForm((current) => ({ ...current, permanent_city: event.target.value }))}
                    onBlur={() => handleBlur('permanent_city')}
                  />
                ))}
                {field('permanent_state', 'State', (
                  <TextInput
                    value={form.permanent_state}
                    onChange={(event) => setForm((current) => ({ ...current, permanent_state: event.target.value }))}
                    onBlur={() => handleBlur('permanent_state')}
                  />
                ))}
                {field('permanent_postal_code', 'Postal Code', (
                  <TextInput
                    value={form.permanent_postal_code}
                    onChange={(event) => setForm((current) => ({ ...current, permanent_postal_code: event.target.value }))}
                    onBlur={() => handleBlur('permanent_postal_code')}
                  />
                ))}
              </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Preferences</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Timezone</FieldLabel>
                <SelectInput
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  required
                >
                  {Array.from(new Set([...COMMON_TIMEZONES, (meQuery.data?.organization as any)?.settings?.timezone].filter(Boolean))).map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </SelectInput>
                <p className="mt-2 text-xs text-slate-500">Your local timezone for attendance tracking and notifications.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center">
          <p className="text-sm text-slate-500">You can complete this now or skip and update later.</p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              iconLeft={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate(-1)}
            >
              Back
            </Button>
            <Button
              variant="ghost"
              className="w-full border border-slate-200 bg-white sm:w-auto"
              onClick={() => skipMutation.mutate()}
              disabled={skipMutation.isPending || saveMutation.isPending}
            >
              {skipMutation.isPending ? 'Skipping...' : 'Skip for now'}
            </Button>
            <Button
              className="w-full sm:w-auto"
              iconRight={<ChevronRight className="h-4 w-4" />}
              onClick={submitProfile}
              disabled={saveMutation.isPending || !isValid || skipMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save & Continue'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
