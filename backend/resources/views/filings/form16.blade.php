<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 11px; line-height: 1.5; }
.header { text-align: center; margin-bottom: 20px; }
.header h1 { font-size: 16px; margin-bottom: 5px; }
.header h2 { font-size: 14px; margin-top: 0; }
.section { margin-bottom: 15px; }
.section h3 { font-size: 12px; border-bottom: 1px solid #333; padding-bottom: 3px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
table th, table td { border: 1px solid #666; padding: 4px 6px; text-align: left; }
table th { background-color: #f0f0f0; font-size: 10px; }
.footer { margin-top: 30px; }
.signature { margin-top: 40px; }
.signature div { display: inline-block; width: 45%; }
</style>
</head>
<body>
<div class="header">
    <h1>FORM 16</h1>
    <h2>Certificate under Section 203 of the Income-tax Act, 1961</h2>
    <p>For Tax Deducted at Source from Salaries</p>
    <p><strong>Financial Year: {{ $financialYear }}</strong></p>
</div>

<div class="section">
    <h3>Part A - Employer Details</h3>
    <table>
        <tr><th width="40%">Employer Name</th><td>{{ $employer->name }}</td></tr>
        <tr><th>Employer PAN</th><td>{{ $pan }}</td></tr>
        <tr><th>TAN</th><td>{{ $tan }}</td></tr>
        <tr><th>Certificate No.</th><td>{{ $certificateNo }}</td></tr>
    </table>
</div>

<div class="section">
    <h3>Part A - Employee Details</h3>
    <table>
        <tr><th width="40%">Employee Name</th><td>{{ $employee->name }}</td></tr>
        <tr><th>PAN</th><td>{{ $employee->employeeProfile->pan_number ?? 'N/A' }}</td></tr>
        <tr><th>Designation</th><td>{{ $employee->employeeWorkInfo->designation ?? 'N/A' }}</td></tr>
        <tr><th>Period</th><td>{{ $run->month_year }}</td></tr>
        <tr><th>Gross Salary</th><td>₹{{ number_format($item->gross_salary, 2) }}</td></tr>
    </table>
</div>

<div class="section">
    <h3>Part B - Tax Deduction Details</h3>
    <table>
        <tr>
            <th>Component</th>
            <th>Amount (₹)</th>
        </tr>
        <tr><td>Gross Salary</td><td>{{ number_format($item->gross_salary, 2) }}</td></tr>
        <tr><td>Less: Standard Deduction</td><td>{{ number_format(min(75000, $item->gross_salary), 2) }}</td></tr>
        <tr><td>Taxable Income</td><td>{{ number_format(max(0, $item->gross_salary - 75000), 2) }}</td></tr>
        <tr><td><strong>Tax Deducted at Source (TDS)</strong></td><td><strong>₹{{ number_format($item->tds, 2) }}</strong></td></tr>
    </table>
</div>

<div class="section">
    <h3>Verification</h3>
    <p>I hereby certify that the above particulars are true and correct.</p>
    <div class="signature">
        <div>
            <p>Place: {{ $employer->address ?? '______________' }}</p>
            <p>Date: {{ date('d/m/Y') }}</p>
        </div>
        <div style="text-align:right;">
            <p>Signature of Employer</p>
            <p>({{ $employer->name }})</p>
            <p>_________________________</p>
        </div>
    </div>
</div>

@if($remarks)
<div class="section">
    <p><em>Remarks: {{ $remarks }}</em></p>
</div>
@endif

<div class="footer">
    <p style="font-size:9px; color:#666; text-align:center;">
        This is a computer-generated certificate. Digital signature verification pending.
    </p>
</div>
</body>
</html>
