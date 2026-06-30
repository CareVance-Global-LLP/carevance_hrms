import {
  Wallet, Calculator, Shield, MapPin, Layers,
} from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface PayrollItemLite {
  id: number;
  user_id: number;
  net_pay?: number | string;
  pf_employee?: number | string;
  pf_employer?: number | string;
  esi_employee?: number | string;
  esi_employer?: number | string;
  pt?: number | string;
  tds?: number | string;
  arrears?: number | string;
  overtime_pay?: number | string;
  performance_bonus?: number | string;
  payment_status?: string;
  payment_method?: string;
}

interface PayrollRunLite {
  total_pf_employee?: number | string;
  total_pf_employer?: number | string;
  total_esi_employee?: number | string;
  total_esi_employer?: number | string;
  total_pt?: number | string;
  total_tds?: number | string;
  total_lwf?: number | string;
  total_arrears?: number | string;
  total_variable_pay?: number | string;
  total_leave_encashment?: number | string;
  total_nps?: number | string;
  total_vpf?: number | string;
  total_gross?: number | string;
  total_deductions?: number | string;
  total_net_pay?: number | string;
  total_employer_contributions?: number | string;
  total_employees?: number;
}

interface PayrollOutcomeProps {
  run: PayrollRunLite;
  items: PayrollItemLite[];
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
}

function formatINR(amount: number): string {
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

/**
 * PayrollOutcome — the post-run statutory breakdown.
 *
 * Surfaces every number that flows into PF/ESI/PT/TDS filings as a card
 * grid, so the operator can review the totals at a glance before locking
 * the run. Sourced entirely from existing PayrollItem + PayrollMonthlyRun
 * totals — no backend changes required.
 */
export default function PayrollOutcome({ run, items }: PayrollOutcomeProps) {
  const { show } = useToast();

  // Employee Payables — items grouped by payment_method (only paid items have a method)
  const paidItems = items.filter((i) => i.payment_status === 'paid');
  const byMethod = paidItems.reduce<Record<string, { count: number; amount: number }>>((acc, it) => {
    const method = it.payment_method || 'unknown';
    acc[method] = acc[method] ?? { count: 0, amount: 0 };
    acc[method].count += 1;
    acc[method].amount += toNum(it.net_pay);
    return acc;
  }, {});

  const bankTransfer = byMethod.bank_transfer ?? { count: 0, amount: 0 };
  const cheque = byMethod.cheque ?? { count: 0, amount: 0 };
  const cash = byMethod.cash ?? { count: 0, amount: 0 };
  const upi = byMethod.upi ?? { count: 0, amount: 0 };

  // TDS — count items where tds > 0
  const tdsItems = items.filter((i) => toNum(i.tds) > 0);
  const tdsTotal = tdsItems.reduce((sum, i) => sum + toNum(i.tds), 0);
  const cessEstimate = tdsTotal * 0.04; // Simplified: 4% cess (3% education + 1% secondary)

  // PF
  const pfItems = items.filter((i) => toNum(i.pf_employee) > 0);
  const pfEmployeeTotal = toNum(run.total_pf_employee);
  const pfEmployerTotal = toNum(run.total_pf_employer);

  // ESI
  const esiItems = items.filter((i) => toNum(i.esi_employee) > 0);
  const esiEmployeeTotal = toNum(run.total_esi_employee);
  const esiEmployerTotal = toNum(run.total_esi_employer);

  // PT
  const ptItems = items.filter((i) => toNum(i.pt) > 0);
  const ptTotal = toNum(run.total_pt);

  // Other components
  const lwf = toNum(run.total_lwf);
  const arrears = toNum(run.total_arrears);
  const variablePay = toNum(run.total_variable_pay);
  const leaveEncashment = toNum(run.total_leave_encashment);
  const nps = toNum(run.total_nps);
  const vpf = toNum(run.total_vpf);

  const reviewStub = (label: string) => () =>
    show({ kind: 'info', message: `${label} review — coming soon.`, durationMs: 3500 });

  return (
    <div className="space-y-4">
      {/* Financial summary formula bar */}
      <SurfaceCard className="p-4 bg-slate-50">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="font-semibold text-slate-900">Total Payroll Cost</span>
          <span className="font-bold text-slate-900">{formatINR(toNum(run.total_gross))}</span>
          <span className="text-slate-400">=</span>
          <span className="text-slate-600">
            Employee Deposit <span className="font-semibold">{formatINR(toNum(run.total_net_pay))}</span>
          </span>
          <span className="text-slate-400">+</span>
          <span className="text-slate-600">
            Deductions <span className="font-semibold">{formatINR(toNum(run.total_deductions))}</span>
          </span>
          <span className="text-slate-400">+</span>
          <span className="text-slate-600">
            Contributions <span className="font-semibold">{formatINR(toNum(run.total_employer_contributions))}</span>
          </span>
        </div>
      </SurfaceCard>

      {/* 6 statutory cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Card 1: Employee Payables */}
        <StatutoryCard
          title="Employee Payables"
          icon={Wallet}
          accent="emerald"
          primary={[
            { label: 'Bank transfer', value: `${bankTransfer.count} · ${formatINR(bankTransfer.amount)}` },
            ...(upi.count > 0 ? [{ label: 'UPI', value: `${upi.count} · ${formatINR(upi.amount)}` }] : []),
            ...(cheque.count > 0 ? [{ label: 'Cheque', value: `${cheque.count} · ${formatINR(cheque.amount)}` }] : []),
            ...(cash.count > 0 ? [{ label: 'Cash', value: `${cash.count} · ${formatINR(cash.amount)}` }] : []),
            { label: 'Pending disbursal', value: `${(items.length - paidItems.length)} employees` },
          ]}
          action={
            <Button variant="ghost" size="sm" disabled title="Coming soon">
              Manage payments
            </Button>
          }
        />

        {/* Card 2: Income Tax (TDS) */}
        <StatutoryCard
          title="Income Tax (TDS)"
          icon={Calculator}
          accent="violet"
          primary={[
            { label: 'Employees', value: `${tdsItems.length}` },
            { label: 'Income Tax', value: formatINR(tdsTotal) },
            { label: 'Surcharge', value: formatINR(0) },
            { label: 'Cess (4% est.)', value: formatINR(cessEstimate) },
          ]}
          action={
            <Button variant="ghost" size="sm" onClick={reviewStub('TDS')}>
              Review
            </Button>
          }
        />

        {/* Card 3: PF */}
        <StatutoryCard
          title="Provident Fund (PF)"
          icon={Shield}
          accent="blue"
          primary={[
            { label: 'Employees', value: `${pfItems.length}` },
            { label: 'Employee share', value: formatINR(pfEmployeeTotal) },
            { label: 'Employer share', value: formatINR(pfEmployerTotal) },
            { label: 'Other charges', value: formatINR(0) },
          ]}
          action={
            <Button variant="ghost" size="sm" onClick={reviewStub('PF')}>
              Review
            </Button>
          }
        />

        {/* Card 4: ESI */}
        <StatutoryCard
          title="Employee State Insurance (ESI)"
          icon={Shield}
          accent="emerald"
          primary={[
            { label: 'Employees', value: `${esiItems.length}` },
            { label: 'Employee share', value: formatINR(esiEmployeeTotal) },
            { label: 'Employer share', value: formatINR(esiEmployerTotal) },
          ]}
          action={
            <Button variant="ghost" size="sm" onClick={reviewStub('ESI')}>
              Review
            </Button>
          }
        />

        {/* Card 5: Professional Tax */}
        <StatutoryCard
          title="Professional Tax"
          icon={MapPin}
          accent="amber"
          primary={[
            { label: 'Employees', value: `${ptItems.length}` },
            { label: 'Tax payable', value: formatINR(ptTotal) },
          ]}
          action={
            <Button variant="ghost" size="sm" onClick={reviewStub('PT')}>
              Review
            </Button>
          }
        />

        {/* Card 6: Other Components (only show non-zero fields) */}
        <StatutoryCard
          title="Other Components"
          icon={Layers}
          accent="slate"
          primary={[
            ...(lwf > 0 ? [{ label: 'LWF', value: formatINR(lwf) }] : []),
            ...(arrears > 0 ? [{ label: 'Arrears', value: formatINR(arrears) }] : []),
            ...(variablePay > 0 ? [{ label: 'Variable Pay', value: formatINR(variablePay) }] : []),
            ...(leaveEncashment > 0 ? [{ label: 'Leave Encashment', value: formatINR(leaveEncashment) }] : []),
            ...(nps > 0 ? [{ label: 'NPS', value: formatINR(nps) }] : []),
            ...(vpf > 0 ? [{ label: 'VPF', value: formatINR(vpf) }] : []),
            ...(lwf === 0 && arrears === 0 && variablePay === 0 && leaveEncashment === 0 && nps === 0 && vpf === 0
              ? [{ label: 'No additional components', value: '—' }]
              : []),
          ]}
          action={
            <Button variant="ghost" size="sm" onClick={reviewStub('Other')}>
              Review
            </Button>
          }
        />
      </div>
    </div>
  );
}

const ACCENT_STYLES: Record<'emerald' | 'violet' | 'blue' | 'amber' | 'slate', { ring: string; iconBg: string; iconText: string }> = {
  emerald: { ring: 'ring-emerald-200', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
  violet:  { ring: 'ring-violet-200',  iconBg: 'bg-violet-50',  iconText: 'text-violet-600' },
  blue:    { ring: 'ring-blue-200',    iconBg: 'bg-blue-50',    iconText: 'text-blue-600' },
  amber:   { ring: 'ring-amber-200',   iconBg: 'bg-amber-50',   iconText: 'text-amber-600' },
  slate:   { ring: 'ring-slate-200',   iconBg: 'bg-slate-50',   iconText: 'text-slate-600' },
};

function StatutoryCard({
  title,
  icon: Icon,
  accent,
  primary,
  action,
}: {
  title: string;
  icon: any;
  accent: 'emerald' | 'violet' | 'blue' | 'amber' | 'slate';
  primary: Array<{ label: string; value: string }>;
  action?: React.ReactNode;
}) {
  const styles = ACCENT_STYLES[accent];
  return (
    <SurfaceCard className={`p-4 ring-1 ${styles.ring}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`h-8 w-8 rounded-lg ${styles.iconBg} ${styles.iconText} flex items-center justify-center`}>
            <Icon className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        </div>
      </div>
      <dl className="space-y-1.5">
        {primary.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {action && <div className="mt-3 pt-3 border-t border-slate-100">{action}</div>}
    </SurfaceCard>
  );
}
