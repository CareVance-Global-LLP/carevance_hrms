import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { canAccess } from '@/lib/permissions';
import { employeeWorkspaceApi, userApi } from '@/services/api';
import { COMMON_TIMEZONES } from '@/lib/timezones';

const labelize = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function EmployeePersonalDetailsPage() {
  const { employeeId } = useParams();
  const id = Number(employeeId || 0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [aboutForm, setAboutForm] = useState<Record<string, string>>({});
  const [workForm, setWorkForm] = useState<Record<string, any>>({});
  
  // Only the profile owner can edit their personal info
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
    setWorkForm({
      employee_code: workspaceQuery.data.work_info?.employee_code || '',
      designation: workspaceQuery.data.work_info?.designation || '',
      employment_type: workspaceQuery.data.work_info?.employment_type || '',
      work_location: workspaceQuery.data.work_info?.work_location || '',
      expected_start_time: workspaceQuery.data.work_info?.expected_start_time || '',
      expected_timezone: workspaceQuery.data.work_info?.expected_timezone || '',
    });
  }, [workspaceQuery.data]);

  const saveAboutMutation = useMutation({
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

  const saveWorkMutation = useMutation({
    mutationFn: async () => employeeWorkspaceApi.updateWorkInfo(id, {
      expected_start_time: workForm.expected_start_time || null,
      expected_timezone: workForm.expected_timezone || null,
    }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Work information saved.' });
      await queryClient.invalidateQueries({ queryKey: ['employee-workspace', id] });
    },
    onError: (error: any) => {
      setFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Could not save work information.',
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
  
  // Admins, managers who are the direct reporting manager, or custom roles with employee.edit permission can edit work info
  const canEditWorkInfo = canAccess(user, 'employee.edit') || 
                          user?.role === 'admin' || 
                          (user?.role === 'manager' && (data.employee as any)?.reporting_manager_id === user?.id);
  
  const aboutSummaryFields = [
    { label: 'First Name', value: data.about?.first_name },
    { label: 'Last Name', value: data.about?.last_name },
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

  const workSummaryFields = [
    { label: 'Employee Code', value: data.work_info?.employee_code },
    { label: 'Designation', value: data.work_info?.designation },
    { label: 'Department', value: data.work_info?.department?.name },
    { label: 'Employment Type', value: data.work_info?.employment_type },
    { label: 'Work Location', value: data.work_info?.work_location },
    { label: 'Expected Start Time', value: data.work_info?.expected_start_time ? `${data.work_info.expected_start_time} (${data.work_info?.expected_timezone || 'Org timezone'})` : 'Not set (using org default)' },
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

        {canEditOwnProfile ? (
          // Editable form for profile owner
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.keys(aboutForm).map((key) => (
                <div key={key}>
                  <FieldLabel>{labelize(key)}</FieldLabel>
                  {key === 'gender' ? (
                    <SelectInput
                      value={aboutForm[key] || ''}
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
                      onChange={(event) => setAboutForm((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Button onClick={() => saveAboutMutation.mutate()} disabled={saveAboutMutation.isPending}>
                {saveAboutMutation.isPending ? 'Saving...' : 'Save Personal Info'}
              </Button>
            </div>
          </>
        ) : (
          // Read-only view for others (admins, managers, etc.)
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {aboutSummaryFields.map((field) => (
              <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{field.label}</p>
                <p className="mt-2 text-sm font-medium text-slate-950">{field.value || 'Not added yet'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Work Information Section */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Work Information</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Employment details, work schedule, and timezone settings.</p>

        {/* Work Info Summary Grid */}
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workSummaryFields.map((field) => (
            <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{field.label}</p>
              <p className="mt-2 text-sm font-medium text-slate-950">{field.value || 'Not added yet'}</p>
            </div>
          ))}
        </div>

        {/* Work Info Edit Form - Only for Admin/Manager with permissions */}
        {canEditWorkInfo ? (
          <>
            <div className="mt-6 border-t border-slate-200 pt-6">
              <p className="text-sm font-medium text-slate-900">Edit Work Schedule</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Expected Start Time (HH:MM)</FieldLabel>
                  <TextInput
                    type="time"
                    value={workForm.expected_start_time || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, expected_start_time: event.target.value }))}
                  />
                </div>
                <div>
                  <FieldLabel>Expected Timezone</FieldLabel>
                  <SelectInput
                    value={workForm.expected_timezone || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, expected_timezone: event.target.value }))}
                  >
                    <option value="">Use organization default</option>
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </SelectInput>
                </div>
              </div>
            </div>
            <div className="mt-6">
              <Button onClick={() => saveWorkMutation.mutate()} disabled={saveWorkMutation.isPending}>
                {saveWorkMutation.isPending ? 'Saving...' : 'Save Work Info'}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">
              {user?.role === 'manager' 
                ? 'Only admins or the direct reporting manager can edit work information.'
                : 'Only admins or managers with edit permissions can modify work information.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
