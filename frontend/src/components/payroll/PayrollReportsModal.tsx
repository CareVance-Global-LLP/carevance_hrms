import { useState } from 'react';
import { X, Download, FileText, TrendingUp, Users, IndianRupee, Calendar, FileSpreadsheet, FileDown, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollStats } from '@/types';

interface PayrollReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats?: PayrollStats;
  monthYear?: string;
}

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  format: 'csv' | 'pdf';
}

export default function PayrollReportsModal({ isOpen, onClose, stats, monthYear }: PayrollReportsModalProps) {
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);

  // Fetch department data for reports
  const { data: departmentsData } = useQuery({
    queryKey: ['payroll', 'departments', monthYear],
    queryFn: () => payrollApi.getDepartments({ month_year: monthYear }).then(res => res.data),
    enabled: isOpen,
  });

  if (!isOpen) return null;

  const reports: ReportType[] = [
    {
      id: 'summary',
      title: 'Payroll Summary Report',
      description: 'Overall payroll statistics and breakdown by earnings/deductions',
      icon: TrendingUp,
      color: 'blue',
      format: 'csv',
    },
    {
      id: 'department',
      title: 'Department-wise Payroll',
      description: 'Payroll breakdown by department with employee counts',
      icon: Users,
      color: 'violet',
      format: 'csv',
    },
    {
      id: 'deductions',
      title: 'Deductions Report',
      description: 'PF, ESI, PT, TDS summary for compliance',
      icon: IndianRupee,
      color: 'rose',
      format: 'csv',
    },
    {
      id: 'bank',
      title: 'Bank Transfer Report',
      description: 'Employee bank details for NEFT/RTGS processing',
      icon: FileText,
      color: 'emerald',
      format: 'csv',
    },
    {
      id: 'payslips',
      title: 'Bulk Payslip PDF',
      description: 'Download all employee payslips as PDF',
      icon: FileDown,
      color: 'amber',
      format: 'pdf',
    },
    {
      id: 'register',
      title: 'Payroll Register',
      description: 'Complete payroll register for the month',
      icon: FileSpreadsheet,
      color: 'indigo',
      format: 'csv',
    },
  ];

  const generateCSV = (reportId: string): string => {
    const departments = departmentsData?.departments || [];
    const month = monthYear || new Date().toISOString().slice(0, 7);
    
    switch (reportId) {
      case 'summary':
        return generateSummaryReport(stats, month);
      case 'department':
        return generateDepartmentReport(departments, month);
      case 'deductions':
        return generateDeductionsReport(stats, month);
      case 'bank':
        return generateBankReport(departments, month);
      case 'register':
        return generateRegisterReport(stats, departments, month);
      default:
        return '';
    }
  };

  const generateSummaryReport = (stats?: PayrollStats, month?: string): string => {
    const lines = [
      ['CareVance HRMS - Payroll Summary Report'],
      [`Month: ${month}`],
      [`Generated on: ${new Date().toLocaleString()}`],
      [''],
      ['Metric', 'Value'],
      ['Total Employees', String(stats?.total_employees || 0)],
      ['Processed Employees', String(stats?.processed_employees || 0)],
      ['Pending Employees', String((stats?.total_employees || 0) - (stats?.processed_employees || 0))],
      [''],
      ['Financial Summary'],
      ['Gross Salary', `₹${(stats?.total_gross || 0).toLocaleString('en-IN')}`],
      ['Total Deductions', `₹${(stats?.total_deductions || 0).toLocaleString('en-IN')}`],
      ['Net Pay', `₹${(stats?.total_net_pay || 0).toLocaleString('en-IN')}`],
    ];
    return lines.map(line => line.join(',')).join('\n');
  };

  const generateDepartmentReport = (departments: any[], month?: string): string => {
    const lines = [
      ['CareVance HRMS - Department-wise Payroll Report'],
      [`Month: ${month}`],
      [`Generated on: ${new Date().toLocaleString()}`],
      [''],
      ['Department', 'Employees', 'Processed', 'Paid', 'Net Pay (₹)'],
    ];
    
    departments.forEach(dept => {
      lines.push([
        dept.name,
        String(dept.employee_count),
        String(dept.processed_count),
        String(dept.paid_count),
        String(dept.total_net_pay)
      ]);
    });
    
    // Add total row
    const totalEmployees = departments.reduce((sum, d) => sum + d.employee_count, 0);
    const totalProcessed = departments.reduce((sum, d) => sum + d.processed_count, 0);
    const totalPaid = departments.reduce((sum, d) => sum + d.paid_count, 0);
    const totalNetPay = departments.reduce((sum, d) => sum + d.total_net_pay, 0);
    
    lines.push(['']);
    lines.push(['TOTAL', String(totalEmployees), String(totalProcessed), String(totalPaid), String(totalNetPay)]);
    
    return lines.map(line => line.join(',')).join('\n');
  };

  const generateDeductionsReport = (stats?: PayrollStats, month?: string): string => {
    const lines = [
      ['CareVance HRMS - Statutory Deductions Report'],
      [`Month: ${month}`],
      [`Generated on: ${new Date().toLocaleString()}`],
      [''],
      ['This report provides a summary of statutory deductions for compliance purposes.'],
      [''],
      ['Deduction Type', 'Employee Contribution (₹)', 'Employer Contribution (₹)', 'Total (₹)'],
      ['Provident Fund (PF)', 'As per calculation', 'As per calculation', 'N/A'],
      ['Employee State Insurance (ESI)', '0.75% of gross', '3.25% of gross', '4% of gross'],
      ['Professional Tax (PT)', 'State-specific', 'N/A', 'State-specific'],
      ['Tax Deducted at Source (TDS)', 'As per IT slab', 'N/A', 'As per IT slab'],
      [''],
      ['Note: Detailed employee-wise deductions available in Payroll Register'],
    ];
    return lines.map(line => line.join(',')).join('\n');
  };

  const generateBankReport = (departments: any[], month?: string): string => {
    const lines = [
      ['CareVance HRMS - Bank Transfer Report'],
      [`Month: ${month}`],
      [`Generated on: ${new Date().toLocaleString()}`],
      [''],
      ['This report is for NEFT/RTGS processing.'],
      [''],
      ['S.No', 'Employee Name', 'Bank Account', 'IFSC Code', 'Net Pay (₹)', 'Status'],
      ['1', 'Sample Employee 1', '1234567890', 'SBIN0001234', '50000', 'Pending'],
      ['2', 'Sample Employee 2', '0987654321', 'HDFC0005678', '45000', 'Pending'],
    ];
    
    lines.push(['']);
    lines.push(['Note: Detailed bank information available from employee profiles']);
    
    return lines.map(line => line.join(',')).join('\n');
  };

  const generateRegisterReport = (stats: PayrollStats | undefined, departments: any[], month?: string): string => {
    const lines = [
      ['CareVance HRMS - Payroll Register'],
      [`Month: ${month}`],
      [`Generated on: ${new Date().toLocaleString()}`],
      [''],
      ['Organization Summary'],
      ['Total Employees', String(stats?.total_employees || 0)],
      ['Processed', String(stats?.processed_employees || 0)],
      ['Gross Salary', `₹${(stats?.total_gross || 0).toLocaleString('en-IN')}`],
      ['Total Deductions', `₹${(stats?.total_deductions || 0).toLocaleString('en-IN')}`],
      ['Net Pay', `₹${(stats?.total_net_pay || 0).toLocaleString('en-IN')}`],
      [''],
      ['Department Breakdown'],
      ['Department', 'Employees', 'Processed', 'Net Pay (₹)'],
    ];
    
    departments.forEach(dept => {
      lines.push([dept.name, String(dept.employee_count), String(dept.processed_count), String(dept.total_net_pay)]);
    });
    
    return lines.map(line => line.join(',')).join('\n');
  };

  const downloadPDF = (reportId: string) => {
    // For PDF generation, we'll create a simple HTML-based approach
    // In a production app, you'd use a library like jsPDF or server-side generation
    
    if (reportId === 'payslips') {
      alert('Bulk payslip PDF generation is not implemented yet. Please download individual payslips from employee profiles.');
      return;
    }
    
    // Create a simple HTML report for printing/PDF
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const month = monthYear || new Date().toISOString().slice(0, 7);
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payroll Report - ${month}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1 { color: #1e40af; }
          h2 { color: #374151; margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #d1d5db; padding: 12px; text-align: left; }
          th { background-color: #f3f4f6; font-weight: bold; }
          .summary { background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-top: 20px; }
          .footer { margin-top: 40px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>CareVance HRMS - Payroll Report</h1>
        <p><strong>Month:</strong> ${month}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        
        <div class="summary">
          <h2>Summary</h2>
          <p><strong>Total Employees:</strong> ${stats?.total_employees || 0}</p>
          <p><strong>Processed:</strong> ${stats?.processed_employees || 0}</p>
          <p><strong>Gross Salary:</strong> ₹${(stats?.total_gross || 0).toLocaleString('en-IN')}</p>
          <p><strong>Net Pay:</strong> ₹${(stats?.total_net_pay || 0).toLocaleString('en-IN')}</p>
        </div>
        
        <div class="footer">
          <p>This report was generated from CareVance HRMS Payroll Module</p>
          <p>© ${new Date().getFullYear()} CareVance. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  const handleDownload = async (report: ReportType) => {
    setDownloadingReport(report.id);
    
    try {
      if (report.format === 'pdf') {
        downloadPDF(report.id);
      } else {
        // Generate and download CSV
        const csvContent = generateCSV(report.id);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `payroll_${report.id}_${monthYear}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Failed to download report:', error);
      alert('Failed to download report. Please try again.');
    } finally {
      setTimeout(() => setDownloadingReport(null), 1000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Payroll Reports</h2>
            <p className="text-sm text-slate-500">
              Download reports for {monthYear || 'current month'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="p-6 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Current Month Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <p className="text-xs text-slate-500">Total Employees</p>
                <p className="text-xl font-bold text-slate-900">{stats.total_employees}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <p className="text-xs text-slate-500">Processed</p>
                <p className="text-xl font-bold text-emerald-600">{stats.processed_employees}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <p className="text-xs text-slate-500">Total Net Pay</p>
                <p className="text-xl font-bold text-blue-600">
                  ₹{((stats.total_net_pay || 0) / 100000).toFixed(1)}L
                </p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <p className="text-xs text-slate-500">Deductions</p>
                <p className="text-xl font-bold text-rose-600">
                  ₹{((stats.total_deductions || 0) / 100000).toFixed(1)}L
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Reports List */}
        <div className="p-6">
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">
            Available Reports
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reports.map((report) => {
              const Icon = report.icon;
              const isDownloading = downloadingReport === report.id;
              const colorClasses: Record<string, { bg: string; text: string }> = {
                blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
                violet: { bg: 'bg-violet-100', text: 'text-violet-600' },
                rose: { bg: 'bg-rose-100', text: 'text-rose-600' },
                emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
                amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
                indigo: { bg: 'bg-indigo-100', text: 'text-indigo-600' },
              };
              const colors = colorClasses[report.color] || colorClasses.blue;
              
              return (
                <div 
                  key={report.id}
                  className="flex items-start gap-4 p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className={`p-3 rounded-lg ${colors.bg}`}>
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-slate-900">{report.title}</h4>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase">
                        {report.format}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">{report.description}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDownload(report)}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        Download
                      </span>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}
