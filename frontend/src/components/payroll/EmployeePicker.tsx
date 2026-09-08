import { SelectInput, FieldLabel } from '@/components/ui/FormField';
import { useEmployees, type EmployeeLite } from '@/hooks/useEmployees';

interface EmployeePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** "All Employees" or "Select employee…". Defaults to "Select…". */
  emptyLabel?: string;
  /** Whether to allow clearing the selection back to the empty value. */
  required?: boolean;
  label?: string;
  className?: string;
  id?: string;
  /** Restrict to admins only — defaults to all employees. */
  employees?: EmployeeLite[];
  /** Disable the picker (e.g. while a mutation is in-flight). */
  disabled?: boolean;
  includeEmail?: boolean;
}

/**
 * <SelectInput> wrapper that renders the employee dropdown using the shared
 * `useEmployees` query.
 *
 * Replaces the six ad-hoc `useQuery(['payroll-employees'])` + `<SelectInput>`
 * blocks that previously lived in SalaryRevision, FBP, Perquisites, Loans,
 * Arrears, and the per-page modals. Also takes the place of the dead
 * `users[0]` reference in Arrears' Manual Arrear button.
 */
export default function EmployeePicker({
  value,
  onChange,
  emptyLabel = 'Select…',
  required = false,
  label,
  className,
  id,
  employees: providedEmployees,
  disabled,
  includeEmail = true,
}: EmployeePickerProps) {
  const { data: fetched, isLoading } = useEmployees();
  const employees = providedEmployees ?? (Array.isArray(fetched) ? fetched : []);

  return (
    <div className={className}>
      {label ? <FieldLabel htmlFor={id}>{label}</FieldLabel> : null}
      <SelectInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled || isLoading}
        aria-label={label}
      >
        <option value="">{emptyLabel}</option>
        {employees.map((u) => (
          <option key={u.id} value={String(u.id)}>
            {u.name}
            {includeEmail && u.email ? ` (${u.email})` : ''}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
