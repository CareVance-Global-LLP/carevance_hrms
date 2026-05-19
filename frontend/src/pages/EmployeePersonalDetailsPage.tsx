import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { employeeWorkspaceApi } from '@/services/api';

const labelize = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function EmployeePersonalDetailsPage() {
  const { employeeId } = useParams();
  const id = Number(employeeId || 0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [aboutForm, setAboutForm] = useState<Record<string, string>>({});
  const canEditOwnProfile = user?.id === id;

  const workspaceQuery = useQuery({
    queryKey: ['employee-workspace', id],
    queryFn: async () => (await employeeWorkspaceApi.getWorkspace(id)).data,
    enabled: id > 0,
  });

  useEffect(() => {
    if (!workspaceQuery.data) return;
    setAboutForm({
      first_name: workspaceQuery.data.about?.first_name || '',
      last_name: workspaceQuery.data.about?.last_name || '',
      display_name: workspaceQuery.data.about?.display_name || '',
      gender: workspaceQuery.data.about?.gender || '',
      date_of_birth: String(workspaceQuery.data.about?.date_of_birth || '').slice(0, 10),
      phone: workspaceQuery.data.about?.phone || '',
      personal_email: workspaceQuery.data.about?.personal_email || '',
      address_line: workspaceQuery.data.about?.address_line || '',
      city: workspaceQuery.data.about?.city || '',
      state: workspaceQuery.data.about?.state || '',
      postal_code: workspaceQuery.data.about?.postal_code || '',
      emergency_contact_name: workspaceQuery.data.about?.emergency_contact_name || '',
      emergency_contact_number: workspaceQuery.data.about?.emergency_contact_number || '',
      emergency_contact_relationship: workspaceQuery.data.about?.emergency_contact_relationship || '',
    });
  }, [workspaceQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => employeeWorkspaceApi.updateProfile(id, aboutForm),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Personal details saved.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace', id] });
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not save personal details.',
      });
    },
  });

  if (workspaceQuery.isLoading) return <PageLoadingState label="Loading employee details..." />;
  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <PageErrorState
        message={(workspaceQuery.error as any)?.response?.data?.message || 'Failed to load employee details.'}
        onRetry={() => void workspaceQuery.refetch()}
      />
    );
  }

  const data = workspaceQuery.data;
  const summaryFields = [
    { label: 'First Name', value: data.about?.first_name },
    { label: 'Last Name', value: data.about?.last_name },
    { label: 'Display Name', value: data.about?.display_name },
    { label: 'Gender', value: data.about?.gender },
    { label: 'Date of Birth', value: data.about?.date_of_birth },
    { label: 'Phone', value: data.about?.phone },
    { label: 'Personal Email', value: data.about?.personal_email },
    { label: 'Address Line', value: data.about?.address_line },
    { label: 'City', value: data.about?.city },
    { label: 'State', value: data.about?.state },
    { label: 'Postal Code', value: data.about?.postal_code },
    { label: 'Emergency Contact', value: data.about?.emergency_contact_name },
    { label: 'Emergency Number', value: data.about?.emergency_contact_number },
    { label: 'Relationship', value: data.about?.emergency_contact_relationship },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Button variant="secondary" onClick={() => navigate('/employees')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Button>
      </div>

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Employee Details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{data.employee?.name || 'Employee'}</h1>
        <p className="mt-1 text-sm text-slate-500">{data.employee?.email || ''}</p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summaryFields.map((field) => (
            <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{field.label}</p>
              <p className="mt-2 text-sm font-medium text-slate-950">{field.value || 'Not added yet'}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(aboutForm).map((key) => (
            <div key={key}>
              <FieldLabel>{labelize(key)}</FieldLabel>
              {key === 'gender' ? (
                <SelectInput
                  value={aboutForm[key] || ''}
                  disabled={!canEditOwnProfile}
                  onChange={(event) => setAboutForm((current) => ({ ...current, [key]: event.target.value }))}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </SelectInput>
              ) : (
                <TextInput
                  type={key.includes('date') ? 'date' : key.includes('email') ? 'email' : 'text'}
                  value={aboutForm[key] || ''}
                  disabled={!canEditOwnProfile}
                  onChange={(event) => setAboutForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          {!canEditOwnProfile ? (
            <p className="text-sm text-slate-500">Only the profile owner can edit these details.</p>
          ) : null}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !canEditOwnProfile}>
            {saveMutation.isPending ? 'Saving...' : 'Save Personal Info'}
          </Button>
        </div>
      </section>
    </div>
  );
}
