import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Mail, ExternalLink, Copy, Check, ShieldCheck } from 'lucide-react';
import { groupApi } from '../../../services/api';
import type { AddUserWizardForm } from './types';

interface Step2Props {
  form: AddUserWizardForm;
}

const WORK_LOCATION_LABELS: Record<string, string> = {
  office: 'Office',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  admin: 'Admin',
};

/**
 * Format `YYYY-MM-DD` for display without going through `Date`.
 *
 * Parsing a date-only string with `new Date()` reads it as UTC midnight, which
 * renders as the previous day everywhere east of Greenwich — the same shift
 * that made date-only columns land a day early elsewhere in the app.
 */
function formatJoiningDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value || '—';

  const [, year, month, day] = match;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`;
}

function formatCtc(value: number | null): string {
  if (!value) return '—';
  return `₹${value.toLocaleString('en-IN')} / year`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium break-words">{value || '—'}</dd>
    </>
  );
}

export function Step2AccountCreated({ form }: Step2Props) {
  const [copied, setCopied] = useState(false);

  const loginUrl = `${window.location.origin}/login`;

  /*
   * Same key as step 1, so this is served from cache rather than refetched.
   * Needed because the form only carries department *ids* — and a review screen
   * that shows "1, 4" instead of the names cannot be checked by a human, which
   * is the entire reason a review screen exists.
   */
  const { data: departments } = useQuery({
    queryKey: ['add-user-groups'],
    queryFn: async () => {
      const response = await groupApi.getAll();
      return response.data.data.map((group) => ({ id: group.id, name: group.name }));
    },
    staleTime: 5 * 60 * 1000,
  });

  const departmentNames = form.departmentIds
    .map((id) => departments?.find((dept) => dept.id === id)?.name ?? `#${id}`)
    .join(', ');

  const handleCopyLink = () => {
    navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 py-6 space-y-5 max-h-[60vh] overflow-y-auto">
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center">
          <ClipboardCheck className="h-8 w-8 text-blue-600" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Review before creating</h3>
          <p className="mt-1 text-sm text-gray-500">
            Check these details. Creating the account is the next click.
          </p>
        </div>
      </div>

      {/*
        Every field the wizard is about to submit.
        This screen used to show the email and the employee code only, which
        meant the review step could not catch the mistakes it existed to
        catch — a wrong department or a mistyped joining date sailed through.
      */}
      <dl className="grid grid-cols-[minmax(7rem,auto),1fr] gap-x-4 gap-y-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-4">
        <SummaryRow label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
        <SummaryRow label="Email" value={form.email} />
        <SummaryRow label="Phone" value={form.phone} />
        <SummaryRow label="Role" value={ROLE_LABELS[form.role] ?? form.role} />
        <SummaryRow label="Designation" value={form.designation} />
        <SummaryRow label="Employee code" value={form.employeeCode} />
        <SummaryRow label="Department" value={departmentNames} />
        <SummaryRow label="Joining date" value={formatJoiningDate(form.joiningDate)} />
        <SummaryRow label="Work location" value={WORK_LOCATION_LABELS[form.workLocation] ?? form.workLocation} />
        <SummaryRow label="Timezone" value={form.timezone} />
        <SummaryRow label="Annual CTC" value={formatCtc(form.annualCtc)} />
      </dl>

      <div className="flex items-center gap-2 justify-center bg-gray-50 rounded-lg px-4 py-2 text-sm">
        <ExternalLink className="h-4 w-4 text-gray-400 shrink-0" />
        <span className="text-gray-600">Login:</span>
        <strong className="text-gray-900 truncate">{loginUrl}</strong>
        <button
          onClick={handleCopyLink}
          className="ml-auto p-1 hover:bg-gray-200 rounded transition shrink-0"
          title="Copy link"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-gray-400" />
          )}
        </button>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-start gap-3 text-left">
        <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">
            <Mail className="inline h-3.5 w-3.5 mb-0.5 mr-1" />
            No email is sent on this path
          </p>
          <p className="text-xs text-emerald-700 mt-1">
            Selecting <strong>Create Account</strong> sets up {form.email} straight away. You'll get
            their sign-in details at the end to pass on directly.
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">
        You can complete their profile next, or let them fill it in later via self-service.
      </p>
    </div>
  );
}
