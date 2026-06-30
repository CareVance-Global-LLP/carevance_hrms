import EmployeeDetailsSection from '../../../components/EmployeeDetailsSection';
import type { AddUserWizardForm } from './types';

interface Step3Props {
  form: AddUserWizardForm;
  setForm: React.Dispatch<React.SetStateAction<AddUserWizardForm>>;
}

export function Step3Profile({ form }: Step3Props) {
  if (!form.userId) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-slate-500">No user created yet. Please complete Step 1 first.</p>
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
        <EmployeeDetailsSection employeeCode={form.employeeCode || String(form.userId)} editable />
      </div>
    </div>
  );
}
