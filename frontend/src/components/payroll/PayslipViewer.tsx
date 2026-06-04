import { useState, useRef } from 'react';
import { Download, FileText, Printer, Mail, CheckCircle, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayslipData } from '@/types';

interface PayslipViewerProps {
  payslip: PayslipData | null;
  isLoading?: boolean;
}

function formatCurrency(amount: number): string {
  return 'Rs ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PayslipViewer({ payslip, isLoading }: PayslipViewerProps) {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const payslipRef = useRef<HTMLDivElement>(null);

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

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    
    try {
      // Create a printable HTML version
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to download the payslip');
        return;
      }

      const html = generatePayslipHTML(payslip);
      printWindow.document.write(html);
      printWindow.document.close();
      
      // Trigger print dialog
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

    const html = generatePayslipHTML(payslip);
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const handleEmailPayslip = () => {
    // Simulate sending email
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 3000);
  };

  const generatePayslipHTML = (data: PayslipData): string => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payslip - ${data.employee.name} - ${data.month}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          * { box-sizing: border-box; }
          body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            margin: 0; 
            padding: 40px;
            background: white;
            color: #1f2937;
          }
          .payslip-container {
            max-width: 800px;
            margin: 0 auto;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            color: white;
            padding: 30px;
            text-align: center;
          }
          .company-name {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 8px;
          }
          .payslip-title {
            font-size: 18px;
            opacity: 0.9;
          }
          .content {
            padding: 30px;
          }
          .section {
            margin-bottom: 25px;
          }
          .section-title {
            font-size: 14px;
            font-weight: bold;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e5e7eb;
          }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px 30px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f3f4f6;
          }
          .info-label {
            color: #6b7280;
            font-size: 13px;
          }
          .info-value {
            font-weight: 500;
            font-size: 13px;
          }
          .amount-table {
            width: 100%;
            border-collapse: collapse;
          }
          .amount-table th,
          .amount-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
          }
          .amount-table th {
            background: #f9fafb;
            font-size: 12px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
          }
          .amount-table td {
            font-size: 14px;
          }
          .amount-right {
            text-align: right;
            font-family: 'Courier New', monospace;
          }
          .total-row {
            background: #f9fafb;
            font-weight: 600;
          }
          .net-pay {
            background: #ecfdf5;
            padding: 20px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 20px;
          }
          .net-pay-label {
            font-size: 18px;
            font-weight: bold;
            color: #065f46;
          }
          .net-pay-amount {
            font-size: 28px;
            font-weight: bold;
            color: #059669;
            font-family: 'Courier New', monospace;
          }
          .footer {
            padding: 20px 30px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            font-size: 11px;
            color: #6b7280;
            text-align: center;
          }
          .deductions { color: #dc2626; }
          .earnings { color: #059669; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="payslip-container">
          <div class="header">
            <div class="company-name">${data.employer.name}</div>
            <div class="payslip-title">Payslip for ${data.month}</div>
          </div>
          
          <div class="content">
            <!-- Employee Details -->
            <div class="section">
              <div class="section-title">Employee Details</div>
              <div class="info-grid">
                <div class="info-row">
                  <span class="info-label">Employee Name</span>
                  <span class="info-value">${data.employee.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Employee ID</span>
                  <span class="info-value">${data.employee.id}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">PAN Number</span>
                  <span class="info-value">${data.employee.pan || 'N/A'}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">UAN</span>
                  <span class="info-value">${data.employee.uan || 'N/A'}</span>
                </div>
              </div>
            </div>

            <!-- Earnings -->
            <div class="section">
              <div class="section-title">Earnings</div>
              <table class="amount-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th class="amount-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Basic Salary</td>
                    <td class="amount-right earnings">${data.payroll.components.earnings.basic.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>House Rent Allowance (HRA)</td>
                    <td class="amount-right earnings">${data.payroll.components.earnings.hra.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Conveyance Allowance</td>
                    <td class="amount-right earnings">${data.payroll.components.earnings.conveyance.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Special Allowance</td>
                    <td class="amount-right earnings">${data.payroll.components.earnings.special_allowance.toFixed(2)}</td>
                  </tr>
                  <tr class="total-row">
                    <td><strong>Gross Salary</strong></td>
                    <td class="amount-right"><strong>₹${data.payroll.monthly.gross.toFixed(2)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Deductions -->
            <div class="section">
              <div class="section-title">Deductions</div>
              <table class="amount-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th class="amount-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Provident Fund (Employee)</td>
                    <td class="amount-right deductions">${data.payroll.components.deductions.pf_employee.toFixed(2)}</td>
                  </tr>
                  ${data.payroll.components.deductions.esi_employee > 0 ? `
                  <tr>
                    <td>Employee State Insurance (ESI)</td>
                    <td class="amount-right deductions">${data.payroll.components.deductions.esi_employee.toFixed(2)}</td>
                  </tr>
                  ` : ''}
                  <tr>
                    <td>Professional Tax</td>
                    <td class="amount-right deductions">${data.payroll.components.deductions.pt.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Income Tax (TDS)</td>
                    <td class="amount-right deductions">${data.payroll.components.deductions.tds.toFixed(2)}</td>
                  </tr>
                  <tr class="total-row">
                    <td><strong>Total Deductions</strong></td>
                    <td class="amount-right deductions"><strong>₹${data.payroll.monthly.total_deductions.toFixed(2)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Net Pay -->
            <div class="net-pay">
              <span class="net-pay-label">Net Pay</span>
              <span class="net-pay-amount">₹${data.payroll.monthly.net.toFixed(2)}</span>
            </div>

            <!-- Employer Contributions -->
            <div class="section" style="margin-top: 30px;">
              <div class="section-title">Employer Contributions</div>
              <div class="info-grid">
                <div class="info-row">
                  <span class="info-label">Provident Fund (Employer)</span>
                  <span class="info-value">₹${data.payroll.components.employer_contributions.pf_employer.toFixed(2)}</span>
                </div>
                ${data.payroll.components.employer_contributions.esi_employer > 0 ? `
                <div class="info-row">
                  <span class="info-label">ESI (Employer)</span>
                  <span class="info-value">₹${data.payroll.components.employer_contributions.esi_employer.toFixed(2)}</span>
                </div>
                ` : ''}
                <div class="info-row">
                  <span class="info-label">Gratuity</span>
                  <span class="info-value">₹${data.payroll.components.employer_contributions.gratuity.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="footer">
            <p><strong>This is a computer-generated payslip and does not require signature.</strong></p>
            <p>Generated on: ${new Date(data.generated_at).toLocaleString('en-IN')}</p>
            <p style="margin-top: 8px;">© ${new Date().getFullYear()} ${data.employer.name}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-slate-900">Payslip Preview</h3>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Printer className="h-4 w-4" />}
            onClick={handlePrint}
          >
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

      <div className="border border-slate-200 rounded-lg p-6 bg-white">
        {/* Header */}
        <div className="text-center border-b border-slate-200 pb-4 mb-4">
          <h2 className="text-xl font-bold text-slate-900">{payslip.employer.name}</h2>
          <p className="text-sm text-slate-500">Payslip for {payslip.month}</p>
        </div>

        {/* Employee Details */}
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-slate-500">Employee Name</p>
            <p className="font-medium">{payslip.employee.name}</p>
          </div>
          <div>
            <p className="text-slate-500">Employee ID</p>
            <p className="font-medium">{payslip.employee.id}</p>
          </div>
          <div>
            <p className="text-slate-500">PAN</p>
            <p className="font-medium">{payslip.employee.pan || 'N/A'}</p>
          </div>
          <div>
            <p className="text-slate-500">UAN</p>
            <p className="font-medium">{payslip.employee.uan || 'N/A'}</p>
          </div>
        </div>

        {/* Salary Details */}
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-slate-900 mb-2">Earnings</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Basic Salary</span>
                <span>{formatCurrency(payslip.payroll.components.earnings.basic)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">HRA</span>
                <span>{formatCurrency(payslip.payroll.components.earnings.hra)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Conveyance</span>
                <span>{formatCurrency(payslip.payroll.components.earnings.conveyance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Special Allowance</span>
                <span>{formatCurrency(payslip.payroll.components.earnings.special_allowance)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
                <span>Gross Salary</span>
                <span>{formatCurrency(payslip.payroll.monthly.gross)}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-slate-900 mb-2">Deductions</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Provident Fund</span>
                <span>{formatCurrency(payslip.payroll.components.deductions.pf_employee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Professional Tax</span>
                <span>{formatCurrency(payslip.payroll.components.deductions.pt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Income Tax (TDS)</span>
                <span>{formatCurrency(payslip.payroll.components.deductions.tds)}</span>
              </div>
              {payslip.payroll.components.deductions.esi_employee > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">ESI</span>
                  <span>{formatCurrency(payslip.payroll.components.deductions.esi_employee)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
                <span>Total Deductions</span>
                <span>{formatCurrency(payslip.payroll.monthly.total_deductions)}</span>
              </div>
            </div>
          </div>

          {/* Net Pay */}
          <div className="bg-emerald-50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="font-bold text-emerald-900">Net Pay</span>
              <span className="text-2xl font-bold text-emerald-700">
                {formatCurrency(payslip.payroll.monthly.net)}
              </span>
            </div>
          </div>

          {/* Employer Contributions */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">Employer Contributions</h4>
            <div className="space-y-1 text-sm text-blue-800">
              <div className="flex justify-between">
                <span>Provident Fund</span>
                <span>₹{payslip.payroll.components.employer_contributions.pf_employer.toFixed(2)}</span>
              </div>
              {payslip.payroll.components.employer_contributions.esi_employer > 0 && (
                <div className="flex justify-between">
                  <span>ESI</span>
                  <span>₹{payslip.payroll.components.employer_contributions.esi_employer.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Gratuity</span>
                <span>₹{payslip.payroll.components.employer_contributions.gratuity.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-500">
          <p>This is a computer-generated payslip and does not require signature.</p>
          <p>Generated on: {new Date(payslip.generated_at).toLocaleString()}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}
