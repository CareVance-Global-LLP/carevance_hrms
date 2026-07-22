import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { payrollApi } from '@/services/api';
import { formatCurrency } from '@/utils/formatters';

interface PayslipData {
  id: number;
  payslip_number: string;
  pay_month: number;
  pay_year: number;
  status: string;
  attendance: {
    total_days: number;
    days_present: number;
    paid_leave: number;
    lop_days: number;
    half_days: number;
    overtime_hours: number;
  };
  earnings: Record<string, number>;
  deductions: Record<string, number>;
  total_earnings: number;
  total_deductions: number;
  net_payable: number;
  net_pay_words: string;
  statutory: {
    pf_ee: number;
    pf_er: number;
    esi_ee: number;
    esi_er: number;
    pt: number;
    lwf: number;
    tds: number;
  };
  employer_contribution: {
    pf_er: number;
    esi_er: number;
    lwf_er: number;
    edli_admin: number;
    total: number;
  };
  ytd: {
    gross: number;
    deductions: number;
    net: number;
    pf_ee: number;
    esi_ee: number;
    pt: number;
    lwf: number;
  };
  employee: {
    id: number;
    name: string;
    employee_code: string;
    designation: string;
    department: string;
    date_of_joining: string;
    pan: string;
    uan: string;
    pf_account: string;
    bank_account: string;
    ifsc: string;
    pt_state: string;
  } | null;
  organization: {
    name: string;
    logo_url: string | null;
    address: string | null;
    pan: string | null;
  } | null;
  has_pdf: boolean;
  pdf_url: string | null;
  created_at: string;
}

const MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const COMPONENT_LABELS: Record<string, string> = {
  basic: 'Basic Salary',
  hra: 'House Rent Allowance',
  da: 'Dearness Allowance',
  special_allowance: 'Special Allowance',
  conveyance: 'Conveyance Allowance',
  medical: 'Medical Allowance',
  statutory_bonus: 'Statutory Bonus',
  food_allowance: 'Food Allowance',
  overtime: 'Overtime',
  overtime_pay: 'Overtime Pay',
  variable_pay: 'Variable Pay',
  performance_bonus: 'Performance Bonus',
  retention_bonus: 'Retention Bonus',
  arrears: 'Arrears',
  leave_encashment: 'Leave Encashment',
  custom_earnings: 'Custom Earnings',
  pf_ee: 'Provident Fund',
  pf_employee: 'Provident Fund',
  esi_ee: 'Employee State Insurance',
  esi_employee: 'Employee State Insurance',
  pt: 'Professional Tax',
  lwf: 'Labour Welfare Fund',
  tds: 'Income Tax (TDS)',
  nps_employee: 'NPS (Employee)',
  vpf_employee: 'Voluntary PF',
  medical_insurance: 'Medical Insurance',
  life_insurance: 'Life Insurance',
  lOP_deduction: 'Loss of Pay',
  lop: 'Loss of Pay',
  custom_deductions: 'Custom Deductions',
  loan_emi: 'Loan EMI',
  advance_recovery: 'Advance Recovery',
  late_penalty: 'Late Penalty',
  notice_pay_recovery: 'Notice Pay Recovery',
};

function formatLabel(key: string): string {
  return COMPONENT_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrencyShort(amount: number): string {
  return Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PayslipViewer({ payslipId, onBack }: { payslipId: number; onBack?: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['payslip', payslipId],
    queryFn: () => payrollApi.getPayslip(payslipId).then((r) => r.data),
  });

  const downloadMutation = useMutation({
    mutationFn: () => payrollApi.downloadPayslipPdfById(payslipId),
    onSuccess: (response) => {
      if (response.data?.url) {
        window.open(response.data.url, '_blank');
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#3D656B]" />
        <span className="ml-2 text-gray-600">Loading payslip...</span>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500">
        <AlertCircle className="h-6 w-6 mr-2" />
        <span>Failed to load payslip. Please try again.</span>
      </div>
    );
  }

  const payslip: PayslipData = data.data;
  const employee = payslip.employee;
  const org = payslip.organization;
  const isProvisional = payslip.status === 'generated' || payslip.status === 'downloaded';
  const workingDays = Number(payslip.attendance.total_days);
  const daysPresent = Number(payslip.attendance.days_present);
  const paidLeave = Number(payslip.attendance.paid_leave);
  const lopDays = Number(payslip.attendance.lop_days);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Payslip — {MONTH_FULL[payslip.pay_month]} {payslip.pay_year}
            </h2>
          </div>
        </div>
        <button
          onClick={() => downloadMutation.mutate()}
          disabled={downloadMutation.isPending}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-[#233B40] rounded-lg hover:bg-[#16262B] disabled:opacity-50 transition-colors"
        >
          {downloadMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-1.5" />
          )}
          Download PDF
        </button>
      </div>

      {/* Payslip Document */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Dark Header */}
        <div className="bg-[#16262B] text-white px-6 py-5 flex justify-between items-start">
          <div>
            <h1 className="text-lg font-bold">{org?.name || 'Company'}</h1>
            <p className="text-xs opacity-70 mt-1">
              Payslip for {MONTH_FULL[payslip.pay_month]} {payslip.pay_year} · {payslip.payslip_number}
            </p>
          </div>
          <div className="text-right text-xs opacity-85">
            <div className="font-medium">{employee?.name || '—'} {employee?.employee_code ? `· ${employee.employee_code}` : ''}</div>
            <div>{employee?.designation || '—'} {employee?.department ? `· ${employee.department}` : ''}</div>
          </div>
        </div>

        {/* Provisional Label */}
        {isProvisional && (
          <div className="px-6 pt-3">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">Provisional</span>
          </div>
        )}

        {/* Attendance Summary */}
        <div className="px-6 py-4 grid grid-cols-3 gap-4 border-b border-gray-200">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Days Present</p>
            <p className="text-base font-semibold text-gray-900 mt-0.5">{daysPresent} / {workingDays}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Paid Leave</p>
            <p className="text-base font-semibold text-gray-900 mt-0.5">{paidLeave}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">LOP Days</p>
            <p className={`text-base font-semibold mt-0.5 ${lopDays > 0 ? 'text-red-600' : 'text-gray-900'}`}>{lopDays}</p>
          </div>
        </div>

        {/* Earnings & Deductions Side by Side */}
        <div className="grid grid-cols-2 border-b border-gray-200">
          {/* Earnings */}
          <div className="px-6 py-4 border-r border-gray-200">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">Earnings</p>
            <div className="space-y-2">
              {Object.entries(payslip.earnings).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900 font-mono">{formatCurrencyShort(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-semibold border-t border-gray-200 pt-2 mt-2">
                <span className="text-gray-900">Total Earnings</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.total_earnings)}</span>
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="px-6 py-4">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">Deductions</p>
            <div className="space-y-2">
              {Object.entries(payslip.deductions).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900 font-mono">{formatCurrencyShort(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-semibold border-t border-gray-200 pt-2 mt-2">
                <span className="text-gray-900">Total Deductions</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.total_deductions)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Net Pay */}
        <div className="px-6 py-4 bg-[#D9EBED]">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-[10px] text-[#3D656B] uppercase tracking-wide font-semibold">Net Payable</p>
              <p className="text-2xl font-bold text-[#16262B] mt-0.5">₹ {formatCurrencyShort(payslip.net_payable)}</p>
            </div>
            {payslip.net_pay_words && (
              <div className="text-right max-w-xs">
                <p className="text-[10px] text-[#3D656B] uppercase tracking-wide font-semibold">In Words</p>
                <p className="text-xs text-[#233B40] mt-0.5">{payslip.net_pay_words}</p>
              </div>
            )}
          </div>
        </div>

        {/* Employer Contributions + YTD */}
        <div className="grid grid-cols-2 border-t border-gray-200">
          {/* Employer Contributions */}
          <div className="px-6 py-4 border-r border-gray-200">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              Employer Contribution <span className="font-normal text-gray-400">(not part of net pay)</span>
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">PF (Employer)</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.employer_contribution?.pf_er || payslip.statutory?.pf_er || 0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">ESI (Employer)</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.employer_contribution?.esi_er || payslip.statutory?.esi_er || 0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">EDLI Admin</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.employer_contribution?.edli_admin || 0)}</span>
              </div>
            </div>
          </div>

          {/* YTD Summary */}
          <div className="px-6 py-4">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              Year to Date (FY {payslip.pay_year}-{(payslip.pay_year + 1) % 100})
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">Gross YTD</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.ytd?.gross || 0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">Deductions YTD</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.ytd?.deductions || 0)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">Net YTD</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.ytd?.net || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 text-[10px] text-gray-400 space-y-0.5">
          <p>This is a system-generated payslip and does not require a signature.</p>
          <p>Payslip ID: {payslip.payslip_number} · Generated: {payslip.created_at}</p>
        </div>
      </div>
    </div>
  );
}
