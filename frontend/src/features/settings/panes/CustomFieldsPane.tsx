import { LayoutGrid } from 'lucide-react';
import Button from '@/components/ui/Button';
import SettingsCard from '../components/SettingsCard';

const BUILT_IN_FIELDS = [
  'Employee code',
  'Department',
  'Designation',
  'Reporting manager',
  'Joining date',
  'Payroll profile',
];

/**
 * Custom fields are not built yet. The previous version said so only on a
 * disabled button, underneath four hardcoded table rows that read as real
 * configured fields.
 */
export default function CustomFieldsPane() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-slate-300 bg-surface-sunken px-6 py-10 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-surface-card text-slate-600">
          <LayoutGrid className="h-5 w-5" />
        </span>
        <h3 className="text-sm font-semibold text-slate-900">You have not added any custom fields</h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-600">
          When this ships you will be able to add text, date, number and dropdown fields to employee records, and use
          them in filters and reports.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" disabled>
          Add custom field · coming soon
        </Button>
      </div>

      <SettingsCard
        title="Built-in fields"
        description="Already on every employee record. Shown for reference — these cannot be removed."
      >
        <div className="flex flex-wrap gap-2">
          {BUILT_IN_FIELDS.map((field) => (
            <span
              key={field}
              className="rounded-full border border-slate-200 bg-surface-sunken px-3 py-1 text-xs font-medium text-slate-600"
            >
              {field}
            </span>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
