<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'DejaVu Sans', sans-serif;
    margin: 0; padding: 0;
    color: #1f2937; font-size: 11px;
  }
  .header {
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    color: white; padding: 20px; text-align: center;
  }
  .header h1 { margin: 0; font-size: 22px; }
  .header p { margin: 4px 0 0; opacity: 0.9; font-size: 14px; }
  .section { margin: 15px 0; }
  .section-title {
    font-size: 11px; font-weight: bold; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.5px;
    border-bottom: 2px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 10px;
  }
  .info-grid { width: 100%; }
  .info-grid td { padding: 3px 10px; font-size: 11px; }
  .info-grid td:first-child { color: #6b7280; width: 140px; }
  .info-grid td:last-child { font-weight: 500; }
  table.amount { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table.amount th {
    background: #f3f4f6; padding: 7px 10px; text-align: left;
    font-size: 10px; font-weight: 600; color: #6b7280; text-transform: uppercase;
    border-bottom: 1px solid #d1d5db;
  }
  table.amount td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
  table.amount .amt { text-align: right; font-family: 'DejaVu Sans Mono', monospace; }
  .total-row td { background: #f9fafb; font-weight: bold; }
  .net-pay {
    background: #ecfdf5; padding: 15px; border-radius: 6px;
    display: flex; justify-content: space-between; align-items: center; margin-top: 10px;
  }
  .net-pay .label { font-size: 14px; font-weight: bold; color: #065f46; }
  .net-pay .amount { font-size: 22px; font-weight: bold; color: #059669; font-family: 'DejaVu Sans Mono', monospace; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; text-align: center; }
  .earnings { color: #059669; }
  .deductions { color: #dc2626; }
  .employer-box { background: #eff6ff; padding: 10px; border-radius: 6px; margin-top: 10px; }
  .employer-box td { color: #1e40af; font-size: 10px; }
</style>
</head>
<body>

<div class="header">
  <h1>{{ $employerName }}</h1>
  <p>Payslip for {{ $monthYear }}</p>
</div>

<div class="section">
  <div class="section-title">Employee Details</div>
  <table class="info-grid">
    <tr><td>Employee Name</td><td>{{ $employeeName }}</td></tr>
    <tr><td>Employee Code</td><td>{{ $employeeCode ?? '—' }}</td></tr>
    <tr><td>Designation</td><td>{{ $designation ?? '—' }}</td></tr>
    <tr><td>PAN Number</td><td>{{ $panNumber ?? '—' }}</td></tr>
    <tr><td>UAN Number</td><td>{{ $uanNumber ?? '—' }}</td></tr>
    <tr><td>Bank Account</td><td>{{ $bankAccount ?? '—' }}</td></tr>
    <tr><td>Working Days</td><td>{{ $workingDays }}</td></tr>
    <tr><td>Days Present</td><td>{{ $daysPresent }}</td></tr>
    <tr><td>Days Absent</td><td>{{ $daysAbsent }}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">Earnings</div>
  <table class="amount">
    <tr><th>Component</th><th class="amt">Amount (Rs)</th></tr>
    <tr><td>Basic Salary</td><td class="amt earnings">{{ number_format($basic, 2) }}</td></tr>
    <tr><td>House Rent Allowance</td><td class="amt earnings">{{ number_format($hra, 2) }}</td></tr>
    <tr><td>Conveyance Allowance</td><td class="amt earnings">{{ number_format($conveyance, 2) }}</td></tr>
    <tr><td>Special Allowance</td><td class="amt earnings">{{ number_format($specialAllowance, 2) }}</td></tr>
    @if($overtimePay > 0)
    <tr><td>Overtime Pay</td><td class="amt earnings">{{ number_format($overtimePay, 2) }}</td></tr>
    @endif
    <tr class="total-row"><td><strong>Gross Salary</strong></td><td class="amt"><strong>{{ number_format($grossSalary, 2) }}</strong></td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">Deductions</div>
  <table class="amount">
    <tr><th>Component</th><th class="amt">Amount (Rs)</th></tr>
    @if($pfEmployee > 0)
    <tr><td>Provident Fund (Employee)</td><td class="amt deductions">{{ number_format($pfEmployee, 2) }}</td></tr>
    @endif
    @if($esiEmployee > 0)
    <tr><td>Employee State Insurance</td><td class="amt deductions">{{ number_format($esiEmployee, 2) }}</td></tr>
    @endif
    @if($pt > 0)
    <tr><td>Professional Tax</td><td class="amt deductions">{{ number_format($pt, 2) }}</td></tr>
    @endif
    @if($tds > 0)
    <tr><td>Income Tax (TDS)</td><td class="amt deductions">{{ number_format($tds, 2) }}</td></tr>
    @endif
    @if($lopDeduction > 0)
    <tr><td>Loss of Pay</td><td class="amt deductions">{{ number_format($lopDeduction, 2) }}</td></tr>
    @endif
    <tr class="total-row"><td><strong>Total Deductions</strong></td><td class="amt deductions"><strong>{{ number_format($totalDeductions, 2) }}</strong></td></tr>
  </table>
</div>

<div class="net-pay">
  <span class="label">Net Pay</span>
  <span class="amount">Rs {{ number_format($netPay, 2) }}</span>
</div>

<div class="employer-box">
  <div class="section-title" style="border-bottom-color: #bfdbfe; color: #1e40af;">Employer Contributions</div>
  <table class="info-grid">
    <tr><td>Provident Fund (Employer)</td><td>Rs {{ number_format($pfEmployer, 2) }}</td></tr>
    @if($esiEmployer > 0)
    <tr><td>ESI (Employer)</td><td>Rs {{ number_format($esiEmployer, 2) }}</td></tr>
    @endif
    <tr><td>Gratuity</td><td>Rs {{ number_format($gratuity, 2) }}</td></tr>
  </table>
</div>

<div class="footer">
  <p><strong>This is a computer-generated payslip and does not require signature.</strong></p>
  <p>Generated on: {{ $generatedAt }}</p>
  <p>&copy; {{ date('Y') }} {{ $employerName }}. All rights reserved.</p>
</div>

</body>
</html>
