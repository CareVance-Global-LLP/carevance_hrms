import { useState } from 'react';
import { FlaskConical, Play, CheckCircle, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from './HowItWorksCard';
import { useToast } from '@/components/ui/Toast';

const EXAMPLE_FORMULAS = [
  { label: 'HRA (50% of Basic)', expr: 'basic * 0.5', vars: { basic: 50000 } },
  { label: 'Gross Salary', expr: 'basic + hra + conveyance + special_allowance', vars: { basic: 50000, hra: 25000, conveyance: 1600, special_allowance: 10000 } },
  { label: 'PF Employee (12%)', expr: 'min(basic, 15000) * 0.12', vars: { basic: 50000 } },
  { label: 'ESI (0.75% of Gross)', expr: 'gross * 0.0075', vars: { gross: 86600 } },
  { label: 'Net Pay', expr: 'gross - pf_employee - esi_employee - pt - tds', vars: { gross: 86600, pf_employee: 1800, esi_employee: 650, pt: 200, tds: 5000 } },
  { label: 'Overtime Pay (2x)', expr: '(gross / 26 / 8) * overtime_hours * 2', vars: { gross: 86600, overtime_hours: 4 } },
  { label: 'LOP Deduction', expr: '(gross / 26) * lop_days', vars: { gross: 86600, lop_days: 2 } },
  { label: 'Taxable Income (New)', expr: 'max(0, annual_gross - 75000)', vars: { annual_gross: 1200000 } },
];

interface EvaluateResult {
  success: boolean;
  result?: number;
  expression?: string;
  variables_used?: Record<string, number>;
  error?: string;
}

interface ValidateResult {
  valid: boolean;
  errors?: string[];
  parsed?: string;
}

export default function FormulaEngine() {
  const { show } = useToast();
  const [expression, setExpression] = useState('basic * 0.5');
  const [variablesJson, setVariablesJson] = useState('{"basic": 50000}');
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  const evaluateMutation = useMutation({
    mutationFn: () => {
      let vars: Record<string, number> = {};
      try {
        vars = JSON.parse(variablesJson);
      } catch {
        throw new Error('Invalid JSON in variables. Use format: {"basic": 50000}');
      }
      return payrollApi.evaluateFormula(expression, vars);
    },
    onSuccess: (data) => {
      setEvalResult(data as EvaluateResult);
      if (data.success) {
        show({ kind: 'success', message: `Formula evaluated successfully`, durationMs: 3000 });
      }
    },
    onError: (e: any) => {
      setEvalResult({ success: false, error: e.message || 'Evaluation failed' });
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => payrollApi.validateFormula(expression),
    onSuccess: (data) => {
      setValidateResult(data as ValidateResult);
    },
    onError: (e: any) => {
      setValidateResult({ valid: false, errors: [e.message || 'Validation failed'] });
    },
  });

  const handleExampleClick = (expr: string, vars: Record<string, number>) => {
    setExpression(expr);
    setVariablesJson(JSON.stringify(vars, null, 2));
    setEvalResult(null);
    setValidateResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Salary Formula Engine"
        description="Test and validate salary calculation expressions before applying them to payroll templates"
      />
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="A testing environment for salary formula expressions. Admins can evaluate expressions with sample variables to verify correctness before saving templates."
          whenToUse={[
            'Creating a new salary template with custom components',
            'Testing a complex deduction formula (e.g., tiered PF, progressive PT)',
            'Validating that operator precedence is correct (e.g., min/max with percentages)',
            'Debugging why a payroll calculation produced unexpected results',
          ]}
          howItFlows={[
            { step: 1, label: 'Enter expression', desc: 'Write formula using salary component names as variables' },
            { step: 2, label: 'Set variables', desc: 'Provide sample values for each variable in JSON' },
            { step: 3, label: 'Evaluate', desc: 'See the computed result instantly' },
            { step: 4, label: 'Validate', desc: 'Check syntax correctness before saving' },
          ]}
          commonMistakes={[
            'Forgetting that PF wage cap is ₹15,000 (use min(basic, 15000))',
            'Mixing annual and monthly values in the same expression',
            'Not handling division by zero for edge cases (zero working days)',
            'Using gross when you mean net (gross = before deductions)',
          ]}
        />

        {/* Example Formulas */}
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold text-slate-900">Quick Examples</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_FORMULAS.map((ex) => (
              <button
                key={ex.expr}
                onClick={() => handleExampleClick(ex.expr, ex.vars)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-blue-50 hover:text-blue-700 rounded-full transition-colors border border-slate-200"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </SurfaceCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Expression Input */}
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-blue-500" />
              Formula Expression
            </h3>
            <textarea
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50"
              placeholder="e.g., basic * 0.5 + conveyance"
            />
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                size="md"
                iconLeft={<Play className="h-4 w-4" />}
                onClick={() => evaluateMutation.mutate()}
                loading={evaluateMutation.isPending}
              >
                Evaluate
              </Button>
              <Button
                variant="secondary"
                size="md"
                iconLeft={<CheckCircle className="h-4 w-4" />}
                onClick={() => validateMutation.mutate()}
                loading={validateMutation.isPending}
              >
                Validate Syntax
              </Button>
            </div>
          </SurfaceCard>

          {/* Variables Input */}
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Variables (JSON)</h3>
            <textarea
              value={variablesJson}
              onChange={(e) => setVariablesJson(e.target.value)}
              rows={8}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50"
              placeholder='{"basic": 50000, "hra": 25000}'
            />
            <p className="mt-2 text-xs text-slate-500">
              Available variables: basic, hra, conveyance, medical, special_allowance, da, gross, pf_employee, esi_employee, pt, tds, annual_gross, overtime_hours, lop_days, working_days
            </p>
          </SurfaceCard>
        </div>

        {/* Results */}
        {evalResult && (
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Evaluation Result</h3>
            {evalResult.success ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Success</span>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-800">
                    ₹{evalResult.result?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-green-600 mt-1 font-mono">
                    {evalResult.expression}
                  </div>
                </div>
                {evalResult.variables_used && (
                  <div className="text-xs text-slate-500">
                    Variables used: {Object.entries(evalResult.variables_used).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2 text-red-700">
                <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Evaluation Failed</div>
                  <div className="text-sm text-red-600 mt-1">{evalResult.error}</div>
                </div>
              </div>
            )}
          </SurfaceCard>
        )}

        {validateResult && (
          <SurfaceCard className="p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Validation Result</h3>
            {validateResult.valid ? (
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Syntax is valid</span>
              </div>
            ) : (
              <div className="space-y-1">
                {validateResult.errors?.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span className="text-sm">{err}</span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        )}
      </div>
    </div>
  );
}
