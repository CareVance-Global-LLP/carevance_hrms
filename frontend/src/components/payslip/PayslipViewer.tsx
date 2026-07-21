import { useState } from 'react';
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

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
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
  const paidDays = Number(payslip.attendance.days_present) + Number(payslip.attendance.paid_leave);
  const lopDays = Number(payslip.attendance.lop_days);
  const daysPayable = paidDays;

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
              Salary Slip — {MONTH_NAMES[payslip.pay_month]} {payslip.pay_year}
            </h2>
            <p className="text-xs text-gray-400">{payslip.payslip_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {payslip.has_pdf && (
            <button
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
            >
              {downloadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Payslip Content */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Provisional Label */}
        {isProvisional && (
          <div className="px-6 pt-4">
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">Provisional</span>
          </div>
        )}

        {/* Header: Company Info + Logo */}
        <div className="flex justify-between items-start px-6 pt-2 pb-4">
          <div className="flex-1">
            <h1 className="text-[15px] font-bold text-gray-900">
              {MONTH_FULL[payslip.pay_month]} {payslip.pay_year} Payslip
            </h1>
            {org && (
              <>
                <p className="text-sm font-bold text-gray-900 uppercase mt-3">{org.name}</p>
                {org.address && (
                  <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{org.address}</p>
                )}
              </>
            )}
          </div>
          {org?.logo_url && (
            <div className="ml-4 flex-shrink-0">
              <img src={org.logo_url} alt="Company Logo" className="h-14 w-auto object-contain" />
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 mx-6" />

        {/* Employee Name Bar */}
        <div className="px-6 py-2.5">
          <p className="text-[13px] font-bold text-gray-900">{employee?.name ?? '—'}</p>
        </div>
        <div className="border-t border-gray-100 mx-6" />

        {/* Employee Info Grid */}
        <div className="px-6 py-3 grid grid-cols-4 gap-x-4 gap-y-2">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Employee Number</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.employee_code ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Date Joined</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.date_of_joining ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Department</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.department ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Sub Department</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">—</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Designation</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.designation ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Payment Mode</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">Bank Transfer</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">UAN</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.uan ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">PF Number</p>
            <p className="text-xs font-semibold text-gray-900 mt-0.5">{employee?.pf_account ?? '—'}</p>
          </div>
        </div>

        {/* Monthly Salary */}
        <div className="px-6 py-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Monthly Salary</p>
          <p className="text-xs font-semibold text-gray-900 mt-0.5">₹ {formatCurrencyShort(payslip.total_earnings)}</p>
        </div>
        <div className="border-t border-gray-100 mx-6" />

        {/* Salary Details */}
        <div className="px-6 pt-3 pb-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Salary Details</p>
          <div className="grid grid-cols-4 gap-x-4">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Actual Payable Days</p>
              <p className="text-xs font-semibold text-gray-900 mt-0.5">{paidDays}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total Working Days</p>
              <p className="text-xs font-semibold text-gray-900 mt-0.5">{workingDays}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Loss Of Pay Days</p>
              <p className="text-xs font-semibold text-gray-900 mt-0.5">{lopDays}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Days Payable</p>
              <p className="text-xs font-semibold text-gray-900 mt-0.5">{daysPayable}</p>
            </div>
          </div>
        </div>

        {/* Earnings & Deductions */}
        <div className="grid grid-cols-[58%_42%] border-t border-gray-200">
          {/* Earnings */}
          <div className="px-6 py-4 border-r border-gray-200">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 border-b border-gray-200 pb-2">Earnings</p>
            <div className="space-y-1.5">
              {Object.entries(payslip.earnings).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900 font-mono">{formatCurrencyShort(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-semibold border-t border-gray-200 pt-2 mt-2">
                <span className="text-gray-900">Total Earnings (A)</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.total_earnings)}</span>
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="px-6 py-4">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 border-b border-gray-200 pb-2">Taxes &amp; Deductions</p>
            <div className="space-y-1.5">
              {Object.entries(payslip.deductions).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900 font-mono">{formatCurrencyShort(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-xs font-semibold border-t border-gray-200 pt-2 mt-2">
                <span className="text-gray-900">Total Deductions (B)</span>
                <span className="text-gray-900 font-mono">{formatCurrencyShort(payslip.total_deductions)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Net Pay */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <p className="text-sm font-bold text-gray-900">Net Salary Payable (A − B)</p>
            <p className="text-lg font-bold text-gray-900 font-mono">₹ {formatCurrencyShort(payslip.net_payable)}</p>
          </div>
          {payslip.net_pay_words && (
            <p className="text-xs text-gray-500 mt-1 italic">Net Salary in words: <span className="font-medium text-gray-700">{payslip.net_pay_words}</span></p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 text-[10px] text-gray-400 space-y-0.5">
          <p>All figures are in Indian Rupees (₹). This is a computer-generated payslip and does not require a signature.</p>
          <p>Payslip ID: {payslip.payslip_number} &bull; Generated: {payslip.created_at}</p>
        </div>
      </div>
    </div>
  );
}
