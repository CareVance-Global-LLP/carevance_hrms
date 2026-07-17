<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Form 16 — {{ $financialYear }}</title>
<style>
  body { font-family: DejaVu Sans, sans-serif; font-size: 10px; line-height: 1.45; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 3px; }
  h3 { font-size: 11px; margin: 8px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #888; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .header { text-align: center; margin-bottom: 12px; }
  .header .sub { font-size: 10px; color: #555; }
  .meta-grid { width: 100%; border: none; margin-bottom: 8px; }
  .meta-grid td { border: none; padding: 1px 4px; }
  .meta-grid td:first-child { width: 24%; font-weight: 600; }
  .footer { margin-top: 18px; font-size: 9px; color: #555; text-align: center; }
  .signature { margin-top: 30px; }
  .signature div { display: inline-block; width: 48%; }
  .right { text-align: right; }
  .grand { font-weight: 700; background: #fffbe6; }
</style>
</head>
<body>

<div class="header">
  <h1>FORM 16 — PART B</h1>
  <div class="sub">Salary Statement under Section 203 of the Income-tax Act, 1961<br/>
    (issued by the employer — annual salary computation)</div>
  <div class="sub"><strong>Financial Year: {{ $financialYear }}</strong></div>
  <div class="sub" style="color:#a00;">Part A (TDS certificate no. from TRACES) to be attached separately.</div>
</div>

<h2>Part A — Deductor (Employer) Details</h2>
<table>
  <tr><th width="24%">Name</th><td>{{ $employer->name }}</td></tr>
  <tr><th>PAN</th><td>{{ $pan ?: '—' }}</td></tr>
  <tr><th>TAN</th><td>{{ $tan ?: '—' }}</td></tr>
  <tr><th>Address</th><td>{{ $employer->address ?? '—' }}</td></tr>
</table>

<h2>Part A — Deductee (Employee) Details</h2>
<table>
  <tr><th width="24%">Name</th><td>{{ $employee->name }}</td></tr>
  <tr><th>PAN</th><td>{{ $employee->employeeProfile->pan_number ?? '—' }}</td></tr>
  <tr><th>Designation</th><td>{{ $employee->employeeWorkInfo->designation ?? '—' }}</td></tr>
  <tr><th>Period of Employment</th><td>
    @if($months->count() > 0)
      {{ $months->first()->month_year }} to {{ $months->last()->month_year }}
    @else
      —
    @endif
  </td></tr>
  <tr><th>Tax Regime</th><td>{{ ucfirst($taxRegime) }}</td></tr>
</table>

<h2>Part B — Computation of Tax (Annualized)</h2>
<table>
  <tr><th width="60%">Component</th><th class="num">Amount (₹)</th></tr>
  <tr><td>Gross Salary (sum of all {{ $months->count() }} months)</td>
      <td class="num">{{ number_format($totals['gross'], 2) }}</td></tr>
  <tr><td>Less: PF Employee Contribution (annual)</td>
      <td class="num">-{{ number_format($totals['pf_employee'], 2) }}</td></tr>
  <tr><td>Less: Professional Tax (annual)</td>
      <td class="num">-{{ number_format($totals['pt'], 2) }}</td></tr>
  <tr><td>Less: ESI Employee Contribution (annual)</td>
      <td class="num">-{{ number_format($totals['esi_employee'], 2) }}</td></tr>
  @if($taxRegime === 'old')
  <tr><td>Less: Standard Deduction (₹50,000)</td>
      <td class="num">-{{ number_format(50000, 2) }}</td></tr>
  <tr><td><em>Note: Chapter VI-A deductions already applied in the recomputed taxable income shown below.</em></td>
      <td class="num"></td></tr>
  @else
  <tr><td>Less: Standard Deduction (₹75,000 — new regime)</td>
      <td class="num">-{{ number_format(75000, 2) }}</td></tr>
  @endif
  <tr class="grand"><td><strong>Net Taxable Income (annual)</strong></td>
      <td class="num"><strong>{{ number_format($annualizedTds['annual_tax']['taxable_income'] ?? 0, 2) }}</strong></td></tr>
  <tr class="grand"><td><strong>Tax on Total Income (annual)</strong></td>
      <td class="num"><strong>{{ number_format($annualizedTds['annual_tax']['total_tax'] ?? 0, 2) }}</strong></td></tr>
  <tr><td>Less: Rebate u/s 87A (if applicable)</td>
      <td class="num">-{{ number_format($annualizedTds['annual_tax']['rebate_87a'] ?? 0, 2) }}</td></tr>
  <tr><td><strong>Net Tax Liability (annual)</strong></td>
      <td class="num"><strong>{{ number_format(($annualizedTds['annual_tax']['total_tax'] ?? 0) - ($annualizedTds['annual_tax']['rebate_87a'] ?? 0), 2) }}</strong></td></tr>
  <tr class="grand"><td><strong>Tax Deducted at Source (TDS) — Annual</strong></td>
      <td class="num"><strong>₹ {{ number_format($totals['tds'], 2) }}</strong></td></tr>
  <tr><td>Average Monthly TDS</td>
      <td class="num">₹ {{ number_format($totals['tds'] / max(1, $months->count()), 2) }}</td></tr>
</table>

<h3>Month-wise Breakdown</h3>
<table>
  <tr>
    <th>Month</th>
    <th class="num">Gross (₹)</th>
    <th class="num">PF (₹)</th>
    <th class="num">PT (₹)</th>
    <th class="num">TDS (₹)</th>
    <th class="num">Net Pay (₹)</th>
  </tr>
  @foreach($months as $m)
  <tr>
    <td>{{ $m->month_year }}</td>
    <td class="num">{{ number_format($m->gross_salary, 2) }}</td>
    <td class="num">{{ number_format($m->pf_employee, 2) }}</td>
    <td class="num">{{ number_format($m->pt, 2) }}</td>
    <td class="num">{{ number_format($m->tds, 2) }}</td>
    <td class="num">{{ number_format($m->net_pay, 2) }}</td>
  </tr>
  @endforeach
  <tr class="grand">
    <td><strong>Total</strong></td>
    <td class="num"><strong>{{ number_format($totals['gross'], 2) }}</strong></td>
    <td class="num"><strong>{{ number_format($totals['pf_employee'], 2) }}</strong></td>
    <td class="num"><strong>{{ number_format($totals['pt'], 2) }}</strong></td>
    <td class="num"><strong>{{ number_format($totals['tds'], 2) }}</strong></td>
    <td class="num"><strong>{{ number_format($months->sum('net_pay'), 2) }}</strong></td>
  </tr>
</table>

<h3>Verification</h3>
<p>I, the undersigned, on behalf of {{ $employer->name }}, certify that the above
particulars are true and correct and reflect the actual tax deducted at source from
the salary of {{ $employee->name }} for the financial year {{ $financialYear }}.</p>

<div class="signature">
  <div>
    <p>Place: {{ $employer->address ?? '—' }}</p>
    <p>Date: {{ $generatedAt->format('d/m/Y') }}</p>
  </div>
  <div class="right">
    <p>Signature of the Person Responsible for Deduction</p>
    <p><strong>{{ $employer->name }}</strong></p>
    <p>(Authorised Signatory)</p>
    <p>_________________________</p>
  </div>
</div>

<div class="footer">
  This is a computer-generated Part B (Salary Statement) for FY {{ $financialYear }}.
  Part A — the certificate of TDS deducted, bearing the certificate number issued by
  TRACES — must be downloaded by the employer from TRACES after quarterly TDS returns
  are filed, and attached to this Part B before issuing to the employee.
  The figures above are derived from monthly payroll_items records aggregated for FY {{ $financialYear }}.
</div>

</body>
</html>
