import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { settingsApi } from '@/services/api';
import type { EmployeeProfileDetails } from '@/types';

type ProfileForm = {
  first_name: string;
  last_name: string;
  display_name: string;
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
};

const createEmptyForm = (): ProfileForm => ({
  first_name: '',
  last_name: '',
  display_name: '',
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
});

const normalizeProfile = (profile?: EmployeeProfileDetails | null): ProfileForm => ({
  first_name: String(profile?.first_name || ''),
  last_name: String(profile?.last_name || ''),
  display_name: String(profile?.display_name || ''),
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
});

export default function ProfileOnboardingPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState<ProfileForm>(createEmptyForm());
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const meQuery = useQuery({
    queryKey: ['settings-me-onboarding'],
    queryFn: async () => (await settingsApi.me()).data,
  });

  useEffect(() => {
    const profile = meQuery.data?.employee_profile || user?.employee_profile;
    if (profile) {
      setForm(normalizeProfile(profile));
      return;
    }

    if (user?.name) {
      const [firstName = '', ...rest] = String(user.name).trim().split(' ');
      setForm((current) => ({
        ...current,
        first_name: current.first_name || firstName,
        last_name: current.last_name || rest.join(' '),
        display_name: current.display_name || user.name,
        personal_email: current.personal_email || String(user.email || ''),
      }));
    }
  }, [meQuery.data?.employee_profile, user?.email, user?.employee_profile, user?.name]);

  const isValid = useMemo(
    () => Object.values(form).every((value) => String(value).trim() !== ''),
    [form]
  );

  const totalFields = Object.keys(form).length;
  const completedFields = useMemo(
    () => Object.values(form).filter((value) => String(value).trim() !== '').length,
    [form]
  );
  const progressPercentage = Math.round((completedFields / Math.max(1, totalFields)) * 100);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return settingsApi.updateOnboardingProfile(form);
    },
    onSuccess: (response) => {
      updateUser(response.data.user);
      setFeedback({ tone: 'success', message: 'Profile details saved successfully.' });
      navigate('/dashboard', { replace: true });
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not save profile details.',
      });
    },
  });

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
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Welcome to CareVance Tracker</p>
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
                <div><FieldLabel>First Name</FieldLabel><TextInput value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} required /></div>
                <div><FieldLabel>Last Name</FieldLabel><TextInput value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} required /></div>
                <div><FieldLabel>Display Name</FieldLabel><TextInput value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} required /></div>
                <div>
                  <FieldLabel>Gender</FieldLabel>
                  <SelectInput value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))} required>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </SelectInput>
                </div>
                <div><FieldLabel>Date of Birth</FieldLabel><TextInput type="date" value={form.date_of_birth} onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value }))} required /></div>
                <div><FieldLabel>Phone</FieldLabel><TextInput value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required /></div>
                <div className="md:col-span-2"><FieldLabel>Personal Email</FieldLabel><TextInput type="email" value={form.personal_email} onChange={(event) => setForm((current) => ({ ...current, personal_email: event.target.value }))} required /></div>
              </div>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Address & Emergency Contact</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2"><FieldLabel>Address Line</FieldLabel><TextInput value={form.address_line} onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))} required /></div>
                <div><FieldLabel>City</FieldLabel><TextInput value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} required /></div>
                <div><FieldLabel>State</FieldLabel><TextInput value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} required /></div>
                <div><FieldLabel>Postal Code</FieldLabel><TextInput value={form.postal_code} onChange={(event) => setForm((current) => ({ ...current, postal_code: event.target.value }))} required /></div>
                <div className="md:col-span-2"><FieldLabel>Emergency Contact Name</FieldLabel><TextInput value={form.emergency_contact_name} onChange={(event) => setForm((current) => ({ ...current, emergency_contact_name: event.target.value }))} required /></div>
                <div><FieldLabel>Emergency Contact Number</FieldLabel><TextInput value={form.emergency_contact_number} onChange={(event) => setForm((current) => ({ ...current, emergency_contact_number: event.target.value }))} required /></div>
                <div><FieldLabel>Emergency Contact Relationship</FieldLabel><TextInput value={form.emergency_contact_relationship} onChange={(event) => setForm((current) => ({ ...current, emergency_contact_relationship: event.target.value }))} required /></div>
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
              onClick={() => saveMutation.mutate()}
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
