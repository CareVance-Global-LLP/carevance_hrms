import StatusBadge from '@/components/ui/StatusBadge';
import { payrollStatusLabel, payrollStatusTone } from '@/features/payroll/utils';

export default function PayrollStatusBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  return (
    <StatusBadge tone={payrollStatusTone(status || undefined)} className={className}>
      {payrollStatusLabel(status)}
    </StatusBadge>
  );
}
