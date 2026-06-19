import { useState } from 'react';
import { Download, FileText, Printer, Mail, CheckCircle, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayslipData } from '@/types';

interface PayslipViewerProps {
  payslip: PayslipData | null;
  isLoading?: boolean;
}

interface ComponentRow {
  label: string;
  amount: number;
}

function formatCurrency(amount: number): string {
  return '\u20B9 ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyRaw(amount: number): string {
  return '\u20B9' + amount.toFixed(2);
}

function buildEarningsRows(data: PayslipData): ComponentRow[] {
  const e = data.payroll.components.earnings;
  const rows: ComponentRow[] = [];
  if (e.basic > 0) rows.push({ label: 'Basic Salary', amount: e.basic });
  if (e.hra > 0) rows.push({ label: 'House Rent Allowance', amount: e.hra });
  if (e.conveyance > 0) rows.push({ label: 'Conveyance Allowance', amount: e.conveyance });
  if (e.special_allowance > 0) rows.push({ label: 'Special Allowance', amount: e.special_allowance });
  return rows;
}

function buildDeductionsRows(data: PayslipData): ComponentRow[] {
  const d = data.payroll.components.deductions;
  const rows: ComponentRow[] = [];
  if (d.pf_employee > 0) rows.push({ label: 'Provident Fund', amount: d.pf_employee });
  if (d.esi_employee > 0) rows.push({ label: 'Employee State Insurance', amount: d.esi_employee });
  if (d.pt > 0) rows.push({ label: 'Professional Tax', amount: d.pt });
  if (d.tds > 0) rows.push({ label: 'Income Tax (TDS)', amount: d.tds });
  return rows;
}

export default function PayslipViewer({ payslip, isLoading }: PayslipViewerProps) {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 rounded bg-slate-200" />
          <div className="h-64 rounded bg-slate-200" />
        </div>
      </SurfaceCard>
    );
  }

  if (!payslip) {
    return null;
  }

  const earningsRows = buildEarningsRows(payslip);
  const deductionsRows = buildDeductionsRows(payslip);

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to download the payslip');
        return;
      }
      const html = generatePayslipHTML(payslip, earningsRows, deductionsRows);
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.print();
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print the payslip');
      return;
    }
    const html = generatePayslipHTML(payslip, earningsRows, deductionsRows);
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const handleEmailPayslip = () => {
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const generatePayslipHTML = (data: PayslipData, earnings: ComponentRow[], deductions: ComponentRow[]): string => {
    const earningsRowsHtml = earnings.map(c =>
      `<tr><td>${c.label}</td><td class="amt">${formatCurrencyRaw(c.amount)}</td><td class="amt text-muted">\u2014</td></tr>`
    ).join('');

    const deductionsRowsHtml = deductions.map(c =>
      `<tr><td>${c.label}</td><td class="amt">${formatCurrencyRaw(c.amount)}</td><td class="amt text-muted">\u2014</td></tr>`
    ).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payslip - ${data.employee.name} - ${data.month}</title>
  <style>
    @page { size: A4; margin: 12mm 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      margin: 0; padding: 0;
      color: #1f2937; font-size: 10px;
    }
    table { border-collapse: collapse; width: 100%; }
    .header-left { width: 60%; vertical-align: top; }
    .header-right { width: 40%; vertical-align: top; text-align: right; }
    .company-name { font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 2px; }
    .company-address { font-size: 9px; color: #64748b; line-height: 1.5; }
    .payslip-title { font-size: 14px; font-weight: bold; color: #1e293b; }
    .payslip-subtitle { font-size: 9px; color: #64748b; }
    .hr { border-bottom: 1px solid #e2e8f0; margin: 10px 0; }
    .section-title {
      font-size: 10px; font-weight: bold; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.8px;
      padding-bottom: 4px; margin-bottom: 6px;
    }
    .info-bar { border: 1px solid #e2e8f0; padding: 8px 10px; margin-bottom: 6px; }
    .info-bar td { padding: 1px 6px; font-size: 9px; vertical-align: top; }
    .info-bar .label { color: #64748b; }
    .info-bar .value { font-weight: 600; color: #1e293b; }
    .columns-table td { width: 50%; vertical-align: top; padding: 0; }
    .columns-table td:first-child { padding-right: 8px; }
    .columns-table td:last-child { padding-left: 8px; }
    .amount-table { width: 100%; border-collapse: collapse; }
    .amount-table th {
      background: #1e293b; color: #fff; padding: 5px 8px;
      text-align: left; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .amount-table th.amt, .amount-table td.amt { text-align: right; }
    .amount-table td {
      padding: 4px 8px; border-bottom: 1px solid #f1f5f9;
      font-size: 9px;
    }
    .amount-table .total-row td {
      background: #f8fafc; font-weight: bold; border-top: 1px solid #cbd5e1;
      border-bottom: none; padding: 5px 8px;
    }
    .amount-table .total-row td.amt { font-family: 'Courier New', monospace; }
    .text-muted { color: #94a3b8; }
    .net-pay-box {
      background: #ecfdf5; border: 1px solid #a7f3d0;
      padding: 10px 16px; margin-top: 12px;
    }
    .net-pay-label { font-size: 12px; font-weight: bold; color: #065f46; }
    .net-pay-amount { font-size: 18px; font-weight: bold; color: #059669; font-family: 'Courier New', monospace; text-align: right; }
    .footer {
      margin-top: 18px; padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 8px; color: #94a3b8; text-align: center; line-height: 1.6;
    }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

<table>
  <tr>
    <td class="header-left">
      <div class="company-name">${data.employer.name}</div>
      <div class="company-address">&nbsp;</div>
    </td>
    <td class="header-right">
      <div class="payslip-title">Payslip</div>
      <div class="payslip-subtitle">for ${data.month}</div>
    </td>
  </tr>
</table>

<div class="hr"></div>

<table class="info-bar">
  <tr>
    <td class="label">Employee</td>
    <td class="value">${data.employee.name}</td>
    <td class="label" style="padding-left:20px;">Designation</td>
    <td class="value">\u2014</td>
  </tr>
  <tr>
    <td class="label">Employee ID</td>
    <td class="value">${data.employee.id}</td>
    <td class="label" style="padding-left:20px;">PAN</td>
    <td class="value">${data.employee.pan || '\u2014'}</td>
  </tr>
  <tr>
    <td class="label">Bank Account</td>
    <td class="value">${data.employee.bank_account || '\u2014'}</td>
    <td class="label" style="padding-left:20px;">IFSC</td>
    <td class="value">${data.employee.bank_ifsc || '\u2014'}</td>
  </tr>
</table>

<table class="info-bar">
  <tr>
    <td class="label">PF Account No.</td>
    <td class="value">\u2014</td>
    <td class="label" style="padding-left:20px;">UAN</td>
    <td class="value">${data.employee.uan || '\u2014'}</td>
  </tr>
</table>

<table class="columns-table">
  <tr>
    <td>
      <div class="section-title">Earnings</div>
      <table class="amount-table">
        <tr><th>Component</th><th class="amt">Amount (\u20B9)</th><th class="amt">YTD</th></tr>
        ${earningsRowsHtml || '<tr><td colspan="3" style="text-align:center;padding:8px;color:#94a3b8;">No earnings</td></tr>'}
        <tr class="total-row"><td>Gross Salary</td><td class="amt">${formatCurrencyRaw(data.payroll.monthly.gross)}</td><td class="amt text-muted">\u2014</td></tr>
      </table>
    </td>
    <td>
      <div class="section-title">Deductions</div>
      <table class="amount-table">
        <tr><th>Component</th><th class="amt">Amount (\u20B9)</th><th class="amt">YTD</th></tr>
        ${deductionsRowsHtml || '<tr><td colspan="3" style="text-align:center;padding:8px;color:#94a3b8;">No deductions</td></tr>'}
        <tr class="total-row"><td>Total Deductions</td><td class="amt">${formatCurrencyRaw(data.payroll.monthly.total_deductions)}</td><td class="amt text-muted">\u2014</td></tr>
      </table>
    </td>
  </tr>
</table>

<div class="net-pay-box">
  <table>
    <tr>
      <td class="net-pay-label">Net Pay</td>
      <td class="net-pay-amount">\u20B9 ${data.payroll.monthly.net.toFixed(2)}</td>
    </tr>
  </table>
</div>

<div class="footer">
  <strong>This is a computer-generated payslip and does not require signature.</strong><br>
  Generated on: ${new Date(data.generated_at).toLocaleString('en-IN')}<br>
  &copy; ${new Date().getFullYear()} ${data.employer.name}. All rights reserved.
</div>

</body>
</html>`;
  };

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-slate-900">Payslip Preview</h3>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" iconLeft={<Printer className="h-4 w-4" />} onClick={handlePrint}>
            Print
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={emailSent ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Mail className="h-4 w-4" />}
            onClick={handleEmailPayslip}
          >
            {emailSent ? 'Sent!' : 'Email'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={isGeneratingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
          >
            {isGeneratingPDF ? 'Generating...' : 'Download PDF'}
          </Button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        {/* ═══ HEADER ═══ */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{payslip.employer.name}</h2>
              <p className="text-xs text-slate-400">&nbsp;</p>
            </div>
            <div className="text-right">
              <p className="text-base font-bold text-slate-900">Payslip</p>
              <p className="text-xs text-slate-400">for {payslip.month}</p>
            </div>
          </div>
        </div>

        {/* ═══ EMPLOYEE INFO BAR ═══ */}
        <div className="px-6 pt-4">
          <div className="border border-slate-200 rounded p-3 text-xs space-y-1">
            <div className="flex gap-4">
              <span className="text-slate-400 w-16">Employee</span>
              <span className="font-semibold text-slate-900">{payslip.employee.name}</span>
              <span className="text-slate-400 w-20 ml-8">Designation</span>
              <span className="font-semibold text-slate-900">—</span>
            </div>
            <div className="flex gap-4">
              <span className="text-slate-400 w-16">Employee ID</span>
              <span className="font-semibold text-slate-900">{payslip.employee.id}</span>
              <span className="text-slate-400 w-20 ml-8">PAN</span>
              <span className="font-semibold text-slate-900">{payslip.employee.pan || '—'}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-slate-400 w-16">Bank Account</span>
              <span className="font-semibold text-slate-900">{payslip.employee.bank_account || '—'}</span>
              <span className="text-slate-400 w-20 ml-8">IFSC</span>
              <span className="font-semibold text-slate-900">{payslip.employee.bank_ifsc || '—'}</span>
            </div>
          </div>

          {/* PF / UAN */}
          <div className="border border-slate-200 rounded p-3 text-xs space-y-1 mt-2">
            <div className="flex gap-4">
              <span className="text-slate-400 w-28">PF Account No.</span>
              <span className="font-semibold text-slate-900">—</span>
              <span className="text-slate-400 w-12 ml-8">UAN</span>
              <span className="font-semibold text-slate-900">{payslip.employee.uan || '—'}</span>
            </div>
          </div>
        </div>

        {/* ═══ EARNINGS & DEDUCTIONS SIDE-BY-SIDE ═══ */}
        <div className="px-6 pt-4">
          <div className="flex gap-4">
            {/* Earnings */}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Earnings</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-2 py-1.5 font-medium">Component</th>
                    <th className="text-right px-2 py-1.5 font-medium">Amount (₹)</th>
                    <th className="text-right px-2 py-1.5 font-medium">YTD</th>
                  </tr>
                </thead>
                <tbody>
                  {earningsRows.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-2 py-1">{c.label}</td>
                      <td className="text-right px-2 py-1 font-mono">{formatCurrencyRaw(c.amount)}</td>
                      <td className="text-right px-2 py-1 text-slate-300">—</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold border-t border-slate-300">
                    <td className="px-2 py-1.5">Gross Salary</td>
                    <td className="text-right px-2 py-1.5 font-mono">{formatCurrencyRaw(payslip.payroll.monthly.gross)}</td>
                    <td className="text-right px-2 py-1.5 text-slate-300">—</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Deductions */}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Deductions</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-2 py-1.5 font-medium">Component</th>
                    <th className="text-right px-2 py-1.5 font-medium">Amount (₹)</th>
                    <th className="text-right px-2 py-1.5 font-medium">YTD</th>
                  </tr>
                </thead>
                <tbody>
                  {deductionsRows.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-2 py-1">{c.label}</td>
                      <td className="text-right px-2 py-1 font-mono">{formatCurrencyRaw(c.amount)}</td>
                      <td className="text-right px-2 py-1 text-slate-300">—</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold border-t border-slate-300">
                    <td className="px-2 py-1.5">Total Deductions</td>
                    <td className="text-right px-2 py-1.5 font-mono">{formatCurrencyRaw(payslip.payroll.monthly.total_deductions)}</td>
                    <td className="text-right px-2 py-1.5 text-slate-300">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ═══ NET PAY ═══ */}
        <div className="px-6 pt-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <div className="flex justify-between items-center">
              <span className="font-bold text-emerald-800 text-sm">Net Pay</span>
              <span className="text-lg font-bold text-emerald-600 font-mono">
                {formatCurrency(payslip.payroll.monthly.net)}
              </span>
            </div>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <div className="mt-4 px-6 py-3 border-t border-slate-200 text-[10px] text-slate-400 text-center leading-relaxed">
          <p className="font-semibold">This is a computer-generated payslip and does not require signature.</p>
          <p>Generated on: {new Date(payslip.generated_at).toLocaleString('en-IN')}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}
