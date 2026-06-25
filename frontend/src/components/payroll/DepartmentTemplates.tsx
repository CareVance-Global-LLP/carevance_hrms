import { ArrowLeft } from 'lucide-react';
import Button from '@/components/ui/Button';
import SalaryStructureTemplates from '@/pages/payroll/SalaryStructureTemplates';

interface DepartmentTemplatesProps {
  onBack: () => void;
}

export default function DepartmentTemplates({ onBack }: DepartmentTemplatesProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            iconLeft={<ArrowLeft className="h-4 w-4" />}
          >
            Back to Payroll
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Salary Templates</h1>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Manage percentage-based salary structure templates used across departments.
        </p>
      </div>

      <SalaryStructureTemplates />
    </div>
  );
}
