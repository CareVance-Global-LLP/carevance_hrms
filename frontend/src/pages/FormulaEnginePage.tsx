import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, CheckCircle, AlertCircle, Plus, Trash2, FlaskConical, Calculator, Code2, Sparkles } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import { cn } from '@/utils/cn';

interface VariableEntry {
  key: string;
  value: string;
}

interface EvaluateResult {
  success: boolean;
  result?: number;
  error?: string;
  expression?: string;
  variables_used?: string[];
}

interface ValidateResult {
  valid: boolean;
  error?: string;
  parsed?: string;
  variables?: string[];
}

const EXAMPLE_FORMULAS = [
  { label: 'HRA (50% of Basic)', expression: 'basic * 0.5', variables: { basic: 50000 } },
  { label: 'Gross Salary', expression: 'basic + hra + special_allowance', variables: { basic: 50000, hra: 25000, special_allowance: 15000 } },
  { label: 'PF Employee (12%)', expression: 'basic * 0.12', variables: { basic: 50000 } },
  { label: 'Net Salary', expression: 'gross - pf_employee - pf_employer - tax', variables: { gross: 90000, pf_employee: 6000, pf_employer: 6000, tax: 3000 } },
  { label: 'DA (10% of Basic)', expression: 'basic * 0.1', variables: { basic: 50000 } },
  { label: 'TA Fixed', expression: 'basic * 0.05 + 1000', variables: { basic: 50000 } },
  { label: 'Bonus Calculation', expression: 'basic * 2 * performance_multiplier', variables: { basic: 50000, performance_multiplier: 1.2 } },
  { label: 'CTC to Monthly', expression: 'ctc / 12', variables: { ctc: 1080000 } },
];

export default function FormulaEnginePage() {
  const [expression, setExpression] = useState('');
  const [variables, setVariables] = useState<VariableEntry[]>([{ key: 'basic', value: '50000' }]);
  const [evaluateResult, setEvaluateResult] = useState<EvaluateResult | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  const evaluateMutation = useMutation({
    mutationFn: () => {
      const vars: Record<string, number> = {};
      variables.forEach(v => {
        if (v.key.trim()) {
          vars[v.key.trim()] = parseFloat(v.value) || 0;
        }
      });
      return payrollApi.evaluateFormula(expression, vars);
    },
    onSuccess: (data) => {
      setEvaluateResult({
        success: true,
        result: data.result,
        expression: data.expression ?? expression,
        variables_used: data.variables_used ? Object.keys(data.variables_used) : undefined,
      });
      setValidateResult(null);
    },
    onError: (error: any) => {
      const errData = error?.response?.data;
      setEvaluateResult({
        success: false,
        error: errData?.message || errData?.error || error?.message || 'Evaluation failed',
        expression,
      });
      setValidateResult(null);
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => payrollApi.validateFormula(expression),
    onSuccess: (data) => {
      setValidateResult({
        valid: data.valid !== false,
        parsed: data.parsed,
      });
      setEvaluateResult(null);
    },
    onError: (error: any) => {
      const errData = error?.response?.data;
      setValidateResult({
        valid: false,
        error: errData?.message || errData?.error || error?.message || 'Validation failed',
      });
      setEvaluateResult(null);
    },
  });

  const handleEvaluate = () => {
    if (!expression.trim()) return;
    evaluateMutation.mutate();
  };

  const handleValidate = () => {
    if (!expression.trim()) return;
    validateMutation.mutate();
  };

  const handleExampleClick = (example: typeof EXAMPLE_FORMULAS[0]) => {
    setExpression(example.expression);
    const entries: VariableEntry[] = Object.entries(example.variables).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    setVariables(entries);
    setEvaluateResult(null);
    setValidateResult(null);
  };

  const addVariable = () => {
    setVariables([...variables, { key: '', value: '' }]);
  };

  const removeVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index));
  };

  const updateVariable = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...variables];
    updated[index] = { ...updated[index], [field]: val };
    setVariables(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleEvaluate();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Formula Engine Tester"
        description="Test and validate salary formula expressions with variable substitution before saving them to templates."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          title="How the Formula Engine works"
          intro="Test salary formulas with real values before committing them to employee templates."
          whatIsThis="The Formula Engine evaluates mathematical expressions used in salary structures. It supports standard arithmetic operators (+, -, *, /, %, ^) and references to salary variables like basic, hra, special_allowance, etc. Use this tester to verify syntax and results before saving."
          whenToUse={[
            'Creating a new salary template and want to verify a component formula',
            'Debugging a formula that produces unexpected payroll results',
            'Testing edge cases (zero values, negative numbers) before deployment',
            'Training HR staff on how formula expressions work in CareVance',
          ]}
          howItFlows={[
            { step: 1, label: 'Enter expression', desc: 'Type a formula using variable names and operators (e.g., basic * 0.5 + hra)' },
            { step: 2, label: 'Add variables', desc: 'Provide numeric values for each variable used in the expression' },
            { step: 3, label: 'Validate syntax', desc: 'Click Validate to check for syntax errors without computing' },
            { step: 4, label: 'Evaluate', desc: 'Click Evaluate to compute the result with your variable values' },
          ]}
          commonMistakes={[
            'Using spaces in variable names — use underscores (special_allowance, not special allowance)',
            'Forgetting to provide values for all variables used in the expression',
            'Using unsupported operators — stick to +, -, *, /, %, and ^ (power)',
            'Confusing percentage calculations — use 0.12 for 12%, not 12',
          ]}
        />

        {/* Example Formula Chips */}
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-700">Quick Test Examples</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_FORMULAS.map((example, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(example)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  'border border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700',
                  'active:scale-95'
                )}
              >
                <Code2 className="h-3 w-3" />
                {example.label}
              </button>
            ))}
          </div>
        </SurfaceCard>

        {/* Main Tester Area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Expression Input */}
          <div className="space-y-6">
            <SurfaceCard className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Calculator className="h-5 w-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">Formula Expression</h3>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">
                  Expression
                </label>
                <textarea
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g., basic * 0.5 + hra + special_allowance"
                  rows={3}
                  className={cn(
                    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono',
                    'placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                    'transition-colors resize-none'
                  )}
                />
                <p className="text-xs text-slate-500">
                  Press <kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">Enter</kbd> to evaluate
                </p>
              </div>

              {/* Variables */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700">Variables</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Plus className="h-3.5 w-3.5" />}
                    onClick={addVariable}
                  >
                    Add Variable
                  </Button>
                </div>

                <div className="space-y-2">
                  {variables.map((variable, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <TextInput
                        placeholder="name"
                        value={variable.key}
                        onChange={(e) => updateVariable(index, 'key', e.target.value)}
                        className="flex-1 font-mono text-sm"
                      />
                      <span className="text-slate-400">=</span>
                      <TextInput
                        placeholder="value"
                        value={variable.value}
                        onChange={(e) => updateVariable(index, 'value', e.target.value)}
                        className="flex-2 font-mono text-sm"
                      />
                      <button
                        onClick={() => removeVariable(index)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors"
                        title="Remove variable"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {variables.length === 0 && (
                  <p className="text-xs text-slate-400 italic mt-2">No variables defined. Add one above.</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-6">
                <Button
                  variant="primary"
                  iconLeft={<Play className="h-4 w-4" />}
                  onClick={handleEvaluate}
                  loading={evaluateMutation.isPending}
                  disabled={!expression.trim()}
                  className="flex-1"
                >
                  Evaluate
                </Button>
                <Button
                  variant="secondary"
                  iconLeft={<CheckCircle className="h-4 w-4" />}
                  onClick={handleValidate}
                  loading={validateMutation.isPending}
                  disabled={!expression.trim()}
                  className="flex-1"
                >
                  Validate
                </Button>
              </div>
            </SurfaceCard>
          </div>

          {/* Right: Results */}
          <div className="space-y-6">
            <SurfaceCard className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FlaskConical className="h-5 w-5 text-violet-600" />
                <h3 className="text-base font-semibold text-slate-900">Result</h3>
              </div>

              {/* Evaluate Result */}
              {evaluateResult && (
                <div className="space-y-4">
                  {evaluateResult.success ? (
                    <>
                      <div className="flex items-center gap-2 text-emerald-600">
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Evaluation Successful</span>
                      </div>

                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                        <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider mb-1">Result</p>
                        <p className="text-3xl font-bold text-emerald-700">
                          {typeof evaluateResult.result === 'number'
                            ? Number.isInteger(evaluateResult.result)
                              ? evaluateResult.result.toLocaleString('en-IN')
                              : evaluateResult.result.toFixed(2)
                            : evaluateResult.result}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Expression</p>
                          <code className="block bg-slate-100 rounded px-3 py-2 text-sm font-mono text-slate-800">
                            {evaluateResult.expression}
                          </code>
                        </div>

                        {evaluateResult.variables_used && evaluateResult.variables_used.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Variables Used</p>
                            <div className="flex flex-wrap gap-1.5">
                              {evaluateResult.variables_used.map((v, i) => (
                                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-rose-600">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Evaluation Failed</span>
                      </div>

                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                        <p className="text-xs font-medium text-rose-600 uppercase tracking-wider mb-1">Error</p>
                        <p className="text-sm text-rose-700">{evaluateResult.error}</p>
                      </div>

                      {evaluateResult.expression && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Expression</p>
                          <code className="block bg-slate-100 rounded px-3 py-2 text-sm font-mono text-slate-800">
                            {evaluateResult.expression}
                          </code>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Validate Result */}
              {validateResult && (
                <div className="space-y-4">
                  {validateResult.valid ? (
                    <>
                      <div className="flex items-center gap-2 text-emerald-600">
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Syntax is Valid</span>
                      </div>

                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                        <p className="text-sm text-emerald-700">
                          The formula expression has valid syntax and can be used in salary templates.
                        </p>
                      </div>

                      {validateResult.parsed && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Parsed Expression</p>
                          <code className="block bg-slate-100 rounded px-3 py-2 text-sm font-mono text-slate-800">
                            {validateResult.parsed}
                          </code>
                        </div>
                      )}

                      {validateResult.variables && validateResult.variables.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Detected Variables</p>
                          <div className="flex flex-wrap gap-1.5">
                            {validateResult.variables.map((v, i) => (
                              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono">
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-rose-600">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Syntax Error</span>
                      </div>

                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                        <p className="text-sm text-rose-700">{validateResult.error}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Empty State */}
              {!evaluateResult && !validateResult && (
                <div className="text-center py-12">
                  <FlaskConical className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Enter a formula and click Evaluate or Validate</p>
                  <p className="text-xs text-slate-400 mt-1">Results will appear here</p>
                </div>
              )}
            </SurfaceCard>

            {/* Quick Reference */}
            <SurfaceCard className="p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Quick Reference</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-medium text-slate-600 mb-1">Operators</p>
                  <div className="space-y-0.5 text-slate-500">
                    <p><code className="bg-slate-100 px-1 rounded">+</code> Addition</p>
                    <p><code className="bg-slate-100 px-1 rounded">-</code> Subtraction</p>
                    <p><code className="bg-slate-100 px-1 rounded">*</code> Multiplication</p>
                    <p><code className="bg-slate-100 px-1 rounded">/</code> Division</p>
                    <p><code className="bg-slate-100 px-1 rounded">%</code> Percentage</p>
                    <p><code className="bg-slate-100 px-1 rounded">^</code> Power</p>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-slate-600 mb-1">Common Variables</p>
                  <div className="space-y-0.5 text-slate-500">
                    <p><code className="bg-slate-100 px-1 rounded">basic</code> Basic Salary</p>
                    <p><code className="bg-slate-100 px-1 rounded">hra</code> HRA</p>
                    <p><code className="bg-slate-100 px-1 rounded">special_allowance</code></p>
                    <p><code className="bg-slate-100 px-1 rounded">gross</code> Gross Salary</p>
                    <p><code className="bg-slate-100 px-1 rounded">pf_employee</code></p>
                    <p><code className="bg-slate-100 px-1 rounded">ctc</code> Annual CTC</p>
                  </div>
                </div>
              </div>
            </SurfaceCard>
          </div>
        </div>
      </div>
    </div>
  );
}
