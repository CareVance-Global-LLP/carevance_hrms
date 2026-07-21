<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 12mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DejaVu Sans', sans-serif;
    color: #1f2937; font-size: 9.5px; line-height: 1.4;
  }
  table { border-collapse: collapse; width: 100%; }
  .clearfix::after { content: ''; display: table; clear: both; }

  /* ── Provisional Label ── */
  .provisional-label {
    font-size: 8px; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 1.2px; margin-bottom: 2px;
  }

  /* ── Header ── */
  .header { margin-bottom: 6px; }
  .header-left { float: left; width: 65%; }
  .header-right { float: right; width: 35%; text-align: right; }
  .payslip-title {
    font-size: 18px; font-weight: bold; color: #1e293b;
    margin-bottom: 1px;
  }
  .payslip-title .month { font-weight: normal; color: #475569; }
  .company-name {
    font-size: 12px; font-weight: bold; color: #1e293b;
    text-transform: uppercase; margin-top: 8px; margin-bottom: 2px;
  }
  .company-address { font-size: 8.5px; color: #64748b; line-height: 1.6; }
  .logo-img { max-height: 60px; max-width: 120px; margin-top: 4px; }

  /* ── Divider ── */
  .hr { border-bottom: 1px solid #e2e8f0; margin: 8px 0; }
  .hr-thin { border-bottom: 1px solid #f1f5f9; margin: 4px 0; }

  /* ── Employee Name Bar ── */
  .employee-name-bar {
    font-size: 13px; font-weight: bold; color: #1e293b;
    padding: 6px 0;
  }

  /* ── Info Grid ── */
  .info-grid { width: 100%; margin: 4px 0 6px 0; }
  .info-grid td { padding: 3px 0; vertical-align: top; width: 25%; }
  .info-grid .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-grid .value { font-size: 9px; font-weight: 600; color: #1e293b; }

  /* ── Monthly Salary Row ── */
  .salary-row { margin: 4px 0 6px 0; }
  .salary-row .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .salary-row .value { font-size: 10px; font-weight: 600; color: #1e293b; }

  /* ── Section Title ── */
  .section-title {
    font-size: 9px; font-weight: bold; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.8px;
    padding-bottom: 3px; margin-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
  }

  /* ── Salary Details ── */
  .salary-details { width: 100%; margin: 6px 0; }
  .salary-details td { padding: 3px 0; vertical-align: top; width: 25%; }
  .salary-details .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .salary-details .value { font-size: 9.5px; font-weight: 600; color: #1e293b; }

  /* ── Earnings/Deductions Columns ── */
  .columns-table { width: 100%; margin-top: 8px; }
  .columns-table td { vertical-align: top; padding: 0; }
  .col-earnings { width: 58%; padding-right: 10px; }
  .col-deductions { width: 42%; padding-left: 10px; }

  .comp-list { width: 100%; }
  .comp-list td { padding: 3px 0; font-size: 9px; border-bottom: 1px solid #f8fafc; }
  .comp-list td:last-child { text-align: right; font-family: 'DejaVu Sans Mono', monospace; }
  .comp-list .total-row td {
    font-weight: bold; border-top: 1px solid #cbd5e1;
    border-bottom: none; padding: 5px 0; font-size: 9.5px;
  }
  .comp-list .total-row td:last-child {
    font-family: 'DejaVu Sans Mono', monospace;
  }
  .comp-list .empty-row td {
    color: #94a3b8; text-align: center; padding: 6px 0;
    font-style: italic; font-size: 8.5px;
  }

  /* ── Net Pay Box ── */
  .net-pay-box {
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 3px; padding: 10px 14px; margin-top: 10px;
  }
  .net-pay-label { font-size: 10px; font-weight: bold; color: #334155; }
  .net-pay-amount {
    font-size: 16px; font-weight: bold; color: #0f172a;
    font-family: 'DejaVu Sans Mono', monospace; text-align: right;
  }
  .net-pay-words {
    font-size: 8.5px; color: #475569; margin-top: 3px;
    font-style: italic;
  }

  /* ── Footer ── */
  .footer {
    margin-top: 14px; padding-top: 6px;
    border-top: 1px solid #e2e8f0;
    font-size: 7.5px; color: #94a3b8; line-height: 1.6;
  }
</style>
</head>
<body>

<!-- ════════════ PROVISIONAL LABEL ════════════ -->
<div class="provisional-label">Provisional</div>

<!-- ════════════ HEADER ════════════ -->
<div class="clearfix header">
  <div class="header-left">
    <div class="payslip-title">
      Payslip <span class="month">{{ \Carbon\Carbon::parse($monthYear . '-01')->format('F Y') }}</span>
    </div>
    <div class="company-name">{{ $employerName }}</div>
    <div class="company-address">{!! $companyAddress !!}</div>
  </div>
  <div class="header-right">
    @if($logoBase64)
      <img src="{{ $logoBase64 }}" alt="Logo" class="logo-img">
    @endif
  </div>
</div>

<div class="hr"></div>

<!-- ════════════ EMPLOYEE NAME BAR ════════════ -->
<div class="employee-name-bar">{{ $employeeName }}</div>
<div class="hr-thin"></div>

<!-- ════════════ EMPLOYEE INFO GRID ════════════ -->
<table class="info-grid">
  <tr>
    <td>
      <div class="label">Employee Number</div>
      <div class="value">{{ $employeeCode ?? '—' }}</div>
    </td>
    <td>
      <div class="label">Date Joined</div>
      <div class="value">{{ $dateOfJoining ?? '—' }}</div>
    </td>
    <td>
      <div class="label">Department</div>
      <div class="value">{{ $department ?? '—' }}</div>
    </td>
    <td>
      <div class="label">Sub Department</div>
      <div class="value">{{ $subDepartment ?? '—' }}</div>
    </td>
  </tr>
  <tr>
    <td>
      <div class="label">Designation</div>
      <div class="value">{{ $designation ?? '—' }}</div>
    </td>
    <td>
      <div class="label">Payment Mode</div>
      <div class="value">{{ $paymentMode ?? 'Bank Transfer' }}</div>
    </td>
    <td>
      <div class="label">UAN</div>
      <div class="value">{{ $uanNumber ?? '—' }}</div>
    </td>
    <td>
      <div class="label">PF Number</div>
      <div class="value">{{ $pfAccountNumber ?? '—' }}</div>
    </td>
  </tr>
</table>

<!-- ════════════ MONTHLY SALARY ════════════ -->
<div class="salary-row">
  <div class="label">Monthly Salary</div>
  <div class="value">₹ {{ number_format($grossSalary, 2) }}</div>
</div>
<div class="hr-thin"></div>

<!-- ════════════ SALARY DETAILS ════════════ -->
<div class="section-title">Salary Details</div>
<table class="salary-details">
  <tr>
    <td>
      <div class="label">Actual Payable Days</div>
      <div class="value">{{ $paidDays }}</div>
    </td>
    <td>
      <div class="label">Total Working Days</div>
      <div class="value">{{ $workingDays }}</div>
    </td>
    <td>
      <div class="label">Loss Of Pay Days</div>
      <div class="value">{{ $lopDays }}</div>
    </td>
    <td>
      <div class="label">Days Payable</div>
      <div class="value">{{ $paidDays }}</div>
    </td>
  </tr>
</table>

<!-- ════════════ EARNINGS & DEDUCTIONS ════════════ -->
<table class="columns-table">
  <tr>
    <!-- EARNINGS (58%) -->
    <td class="col-earnings">
      <div class="section-title">Earnings</div>
      <table class="comp-list">
        @forelse($earningsComponents as $comp)
        <tr>
          <td>{{ $comp['label'] }}</td>
          <td>{{ number_format($comp['amount'], 2) }}</td>
        </tr>
        @empty
        <tr class="empty-row"><td colspan="2">No earnings</td></tr>
        @endforelse
        <tr class="total-row">
          <td>Total Earnings (A)</td>
          <td>{{ number_format($grossSalary, 2) }}</td>
        </tr>
      </table>
    </td>

    <!-- DEDUCTIONS (42%) -->
    <td class="col-deductions">
      <div class="section-title">Taxes &amp; Deductions</div>
      <table class="comp-list">
        @forelse($deductionsComponents as $comp)
        <tr>
          <td>{{ $comp['label'] }}</td>
          <td>{{ number_format($comp['amount'], 2) }}</td>
        </tr>
        @empty
        <tr class="empty-row"><td colspan="2">No deductions</td></tr>
        @endforelse
        <tr class="total-row">
          <td>Total Deductions (B)</td>
          <td>{{ number_format($totalDeductions, 2) }}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- ════════════ NET PAY ════════════ -->
<div class="net-pay-box">
  <table style="width:100%">
    <tr>
      <td style="width:60%">
        <div class="net-pay-label">Net Salary Payable (A − B)</div>
      </td>
      <td style="width:40%">
        <div class="net-pay-amount">₹ {{ number_format($netPay, 2) }}</div>
      </td>
    </tr>
  </table>
  @if(!empty($netPayWords))
  <div class="net-pay-words">Net Salary in words: <strong>{{ $netPayWords }}</strong></div>
  @endif
</div>

<!-- ════════════ FOOTER ════════════ -->
<div class="footer">
  <div>All figures are in Indian Rupees (₹). This is a computer-generated payslip and does not require a signature.</div>
  <div>Generated on: {{ $generatedAt }} &bull; &copy; {{ date('Y') }} {{ $employerName }}. All rights reserved.</div>
</div>

</body>
</html>
