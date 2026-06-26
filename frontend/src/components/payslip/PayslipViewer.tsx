import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Loader2, AlertCircle, Eye, ArrowLeft } from 'lucide-react';
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
  has_pdf: boolean;
  pdf_url: string | null;
  created_at: string;
}

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COMPONENT_LABELS: Record<string, string> = {
  basic: 'Basic Salary',
  hra: 'HRA',
  da: 'Dearness Allowance',
  special_allowance: 'Special Allowance',
  conveyance: 'Conveyance',
  medical: 'Medical',
  statutory_bonus: 'Statutory Bonus',
  food_allowance: 'Food Allowance',
  overtime: 'Overtime',
  pf_ee: 'PF (EE)',
  esi_ee: 'ESI (EE)',
  pt: 'Professional Tax',
  lwf: 'LWF',
  tds: 'TDS',
  loan_emi: 'Loan EMI',
  advance_recovery: 'Advance Recovery',
  late_penalty: 'Late Penalty',
};

function formatLabel(key: string): string {
  return COMPONENT_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Salary Slip — {MONTH_NAMES[payslip.pay_month]} {payslip.pay_year}
            </h2>
            <p className="text-sm text-gray-500">{payslip.payslip_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {payslip.has_pdf && (
            <button
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
            >
              {downloadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Payslip Content */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Company Header */}
        <div className="flex justify-between items-start p-6 border-b border-gray-200">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Carevance Infosolutions Pvt Ltd</h1>
            <p className="text-sm text-gray-500">Trust the Process</p>
            <p className="text-sm text-gray-500">123 Business Park, Andheri West</p>
            <p className="text-sm text-gray-500">Mumbai, Maharashtra — 400053</p>
            <p className="text-sm text-gray-500">PAN: AABCT1234A</p>
          </div>
          <div className="text-right">
            <h2 className="text-lg font-semibold text-gray-900">
              SALARY SLIP — {MONTH_NAMES[payslip.pay_month]} {payslip.pay_year}
            </h2>
          </div>
        </div>

        {/* Employee Details */}
        {employee && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-6 border-b border-gray-200 text-sm">
            <div><span className="font-medium">Employee Name:</span> {employee.name}</div>
            <div><span className="font-medium">Pay Month:</span> {MONTH_NAMES[payslip.pay_month]} {payslip.pay_year}</div>
            <div><span className="font-medium">Employee Code:</span> {employee.employee_code}</div>
            <div><span className="font-medium">Designation:</span> {employee.designation}</div>
            <div><span className="font-medium">Department:</span> {employee.department}</div>
            <div><span className="font-medium">Date of Joining:</span> {employee.date_of_joining}</div>
            <div><span className="font-medium">UAN:</span> {employee.uan}</div>
            <div><span className="font-medium">PAN:</span> {employee.pan}</div>
            <div><span className="font-medium">PF Account:</span> {employee.pf_account}</div>
            <div><span className="font-medium">Bank Acct:</span> {employee.bank_account} ({employee.ifsc})</div>
            <div><span className="font-medium">Gross:</span> ₹{formatCurrency(payslip.total_earnings)}</div>
            <div><span className="font-medium">Status:</span> <span className="capitalize">{payslip.status}</span></div>
          </div>
        )}

        {/* Attendance */}
        <div className="p-4 bg-gray-50 border-b border-gray-200 text-center text-sm">
          <span className="font-medium">Attendance:</span>{' '}
          Total Days: {payslip.attendance.total_days} | Present: {payslip.attendance.days_present} | Paid Leave: {payslip.attendance.paid_leave} | LOP: {payslip.attendance.lop_days}
          {payslip.attendance.overtime_hours > 0 && ` | OT: ${payslip.attendance.overtime_hours}h`}
        </div>

        {/* Earnings & Deductions */}
        <div className="grid grid-cols-2">
          {/* Earnings */}
          <div className="p-6 border-r border-gray-200">
            <h3 className="font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-3">EARNINGS</h3>
            <div className="space-y-2">
              {Object.entries(payslip.earnings).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900">₹{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-2 mt-2">
                <span>TOTAL EARNINGS (A)</span>
                <span>₹{formatCurrency(payslip.total_earnings)}</span>
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-3">DEDUCTIONS</h3>
            <div className="space-y-2">
              {Object.entries(payslip.deductions).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatLabel(key)}</span>
                  <span className="text-gray-900">₹{formatCurrency(value)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-gray-200 pt-2 mt-2">
                <span>TOTAL DEDUCTIONS (B)</span>
                <span>₹{formatCurrency(payslip.total_deductions)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Net Pay */}
        <div className="p-6 bg-gray-50 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-600 mb-1">NET PAYABLE (A − B)</p>
          <p className="text-2xl font-bold text-gray-900">₹ {formatCurrency(payslip.net_payable)}</p>
          <p className="text-sm text-gray-500 mt-1 italic">{payslip.net_pay_words}</p>
        </div>

        {/* Employer Contribution */}
        <div className="p-6 border-t border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">Employer Contribution</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">PF (ER)</span><span>₹{formatCurrency(payslip.employer_contribution.pf_er)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">ESI (ER)</span><span>₹{formatCurrency(payslip.employer_contribution.esi_er)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">LWF (ER)</span><span>₹{formatCurrency(payslip.employer_contribution.lwf_er)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">EDLI + Admin</span><span>₹{formatCurrency(payslip.employer_contribution.edli_admin)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span>₹{formatCurrency(payslip.employer_contribution.total)}</span></div>
          </div>
        </div>

        {/* YTD Summary */}
        <div className="p-6 border-t border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">Year-to-Date (YTD) Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-gray-500">Gross YTD</p>
              <p className="font-semibold text-gray-900">₹{formatCurrency(payslip.ytd.gross)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-gray-500">Deductions YTD</p>
              <p className="font-semibold text-gray-900">₹{formatCurrency(payslip.ytd.deductions)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-gray-500">Net YTD</p>
              <p className="font-semibold text-gray-900">₹{formatCurrency(payslip.ytd.net)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-gray-500">PF YTD</p>
              <p className="font-semibold text-gray-900">₹{formatCurrency(payslip.ytd.pf_ee)}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          <p>• All figures in Indian Rupees (₹).</p>
          <p>• System-generated — no signature required.</p>
          <p>Payslip ID: {payslip.payslip_number} | Generated: {payslip.created_at}</p>
        </div>
      </div>
    </div>
  );
}
