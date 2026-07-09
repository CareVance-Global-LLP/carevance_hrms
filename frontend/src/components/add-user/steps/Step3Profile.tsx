import { ArrowLeft } from 'lucide-react';
import EmployeeDetailsSection from '../../../components/EmployeeDetailsSection';
import type { AddUserWizardForm } from './types';

interface Step3Props {
  form: AddUserWizardForm;
  setForm: React.Dispatch<React.SetStateAction<AddUserWizardForm>>;
  isCreatingUser: boolean;
  creationError: string | null;
  onGoBack: () => void;
}

export function Step3Profile({ form, isCreatingUser, creationError, onGoBack }: Step3Props) {
  if (isCreatingUser) {
    return (
      <div className="px-6 py-16 text-center space-y-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <svg className="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">Creating account...</p>
        <p className="text-xs text-slate-400">Setting up the employee profile for {form.email}</p>
      </div>
    );
  }

  if (creationError) {
    return (
      <div className="px-6 py-10 text-center space-y-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <span className="text-xl">!</span>
        </div>
        <p className="text-sm text-red-600 font-medium">{creationError}</p>
        <button
          onClick={onGoBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back and try again
        </button>
      </div>
    );
  }

  if (!form.userId) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-slate-500">Unable to load profile. Please go back and try again.</p>
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
        <p className="text-xs text-blue-700 font-medium">
          Complete the employee's profile below. All fields are optional — the employee can also fill them later.
        </p>
      </div>
      <div className="p-4">
        <EmployeeDetailsSection
          userId={form.userId}
          employeeCode={form.employeeCode || String(form.userId ?? '')}
          editable
        />
      </div>
    </div>
  );
}
