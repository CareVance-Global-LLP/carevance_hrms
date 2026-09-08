import { SelectInput, FieldLabel } from '@/components/ui/FormField';
import {
  payrollStatusRegistry,
  type PayrollStatusNamespace,
} from '@/utils/payrollStatusRegistry';

interface StatusFilterProps {
  namespace: PayrollStatusNamespace;
  value: string;
  onChange: (value: string) => void;
  /** Optional label override (defaults to "Status"). */
  label?: string;
  /** Whether to include an "All Status" empty option (default: true). */
  includeAll?: boolean;
  allLabel?: string;
  className?: string;
  id?: string;
}

/**
 * <SelectInput> wrapper that renders a status dropdown for a single namespace.
 *
 * Replaces per-page `<SelectInput>` blocks that hand-rolled the option list
 * inline. Add a new status to the registry, not to a page.
 */
export default function StatusFilter({
  namespace,
  value,
  onChange,
  label = 'Status',
  includeAll = true,
  allLabel = 'All Status',
  className,
  id,
}: StatusFilterProps) {
  const options = payrollStatusRegistry[namespace] ?? [];

  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <SelectInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {includeAll ? <option value="">{allLabel}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
