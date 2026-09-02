<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  {{--
    Two things about this stylesheet are load-bearing and easy to undo.

    1. NO MONOSPACE FACE. Amounts used 'DejaVu Sans Mono', which made a payroll
       document look like a dot-matrix printout for no benefit — DejaVu Sans
       already sets every digit on the same advance width, so a column of
       figures aligns in the body face. Reintroducing the mono face changes
       nothing about alignment and everything about how the slip reads.

    2. THE GUTTER IS A CELL, NOT PADDING. dompdf has no flexbox and no grid, and
       10px of padding either side left the earnings amount roughly one point
       from the next deduction label — so every row rendered as
       "20,000.00Provident Fund". A dedicated spacer column cannot collapse.
  --}}
  /*
     THE MARGIN IS BODY PADDING, NOT @page.

     `@page { margin: 12mm 15mm }` was here from the start and did nothing:
     measured on the rendered PDF, content began at 0.0mm from the left edge and
     ended at 0.0mm from the right. dompdf does not apply @page margins, so
     every payslip ever produced ran the full width of the paper — the earnings
     labels touched the left edge and the deduction amounts touched the right,
     and a printer's own unprintable border clipped them further.

     Body padding is what dompdf honours. It is stated in mm because this is a
     sheet of A4 that people print, not a screen.
  */
  @page { margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DejaVu Sans', sans-serif;
    color: #1f2937; font-size: 9.5px; line-height: 1.4;
    padding: 14mm 16mm;
  }
  table { border-collapse: collapse; width: 100%; }
  .clearfix::after { content: ''; display: table; clear: both; }

  /* ── Header ── */
  .header { margin-bottom: 6px; }
  .header-left { float: left; width: 62%; }
  .header-right { float: right; width: 38%; text-align: right; }
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
  .logo-img { max-height: 52px; max-width: 120px; margin-bottom: 4px; }
  .doc-meta { font-size: 8px; color: #64748b; line-height: 1.7; }
  .doc-meta .k { color: #94a3b8; }

  /* ── Dividers ── */
  .hr { border-bottom: 1.5px solid #5D969D; margin: 8px 0; }
  .hr-thin { border-bottom: 1px solid #e2e8f0; margin: 4px 0; }

  /* ── Unsettled-figures notice ── */
  .notice {
    border: 1px solid #d9b982; background: #fdf6e8;
    border-radius: 3px; padding: 6px 9px; margin: 8px 0;
  }
  .notice-title {
    font-size: 8px; font-weight: bold; color: #8a6220;
    text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;
  }
  .notice-reason { font-size: 8.5px; color: #7a5a22; line-height: 1.5; }

  /* ── Employee name bar ── */
  .employee-name-bar {
    font-size: 13px; font-weight: bold; color: #1e293b;
    padding: 6px 0;
  }

  /* ── Info grid ── */
  .info-grid { width: 100%; margin: 4px 0 6px 0; }
  .info-grid td { padding: 3px 6px 3px 0; vertical-align: top; width: 25%; }
  .info-grid .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-grid .value { font-size: 9px; font-weight: 600; color: #1e293b; }

  /* ── Monthly salary row ── */
  .salary-row { margin: 4px 0 6px 0; }
  .salary-row .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .salary-row .value { font-size: 10px; font-weight: 600; color: #1e293b; }

  /* ── Section title ── */
  .section-title {
    font-size: 9px; font-weight: bold; color: #3D656B;
    text-transform: uppercase; letter-spacing: 0.8px;
    padding-bottom: 3px; margin-bottom: 4px;
    border-bottom: 1px solid #5D969D;
  }

  /* ── Salary details ── */
  .salary-details { width: 100%; margin: 6px 0 3px 0; }
  .salary-details td { padding: 3px 0; vertical-align: top; width: 25%; }
  .salary-details .label { font-size: 7.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .salary-details .value { font-size: 9.5px; font-weight: 600; color: #1e293b; }
  .basis-note { font-size: 8px; color: #64748b; font-style: italic; padding-bottom: 8px; }

  /* ── Earnings / deductions columns ── */
  .columns-table { width: 100%; margin-top: 8px; }
  .columns-table > tbody > tr > td { vertical-align: top; padding: 0; }
  /*
     The three widths MUST total exactly 100% with no padding on top.

     They were 48/4/48 plus `padding-left: 12px` on the deductions cell — 100%
     of the page and then twelve points more. dompdf does not honour box-sizing
     on a table cell reliably, so the overflow pushed the right-hand column past
     the page margin and the amounts were clipped at the edge: "1,800.00" landed
     half off the paper. The gutter cell is the separation; it does not need
     help from padding, and widening it is how you get more of it.
  */
  .col-earnings   { width: 45%; }
  .col-gutter     { width: 10%; border-right: 1px solid #e2e8f0; }
  .col-deductions { width: 45%; }

  .comp-list { width: 100%; }
  .col-deductions .comp-list td:first-child { padding-left: 10px; }
  .comp-list td { padding: 3px 0; font-size: 9px; border-bottom: 1px solid #f1f5f9; }
  .comp-list td.amt { text-align: right; width: 38%; white-space: nowrap; padding-right: 2px; }
  .comp-list .spacer-row td { border-bottom: 1px solid #f1f5f9; }
  .comp-list .total-row td {
    font-weight: bold; border-top: 1.5px solid #3D656B;
    border-bottom: none; padding: 5px 0; font-size: 9.5px;
  }
  .comp-list .empty-row td {
    color: #94a3b8; text-align: center; padding: 6px 0;
    font-style: italic; font-size: 8.5px;
  }

  /* ── Net pay box ── */
  .net-pay-box {
    background: #edf4f5; border: 1px solid #5D969D;
    border-radius: 3px; padding: 10px 14px; margin-top: 10px;
  }
  .net-pay-label { font-size: 10px; font-weight: bold; color: #3D656B; }
  .net-pay-amount {
    font-size: 16px; font-weight: bold; color: #3D656B;
    text-align: right; white-space: nowrap;
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

<!-- ════════════ HEADER ════════════ -->
<div class="clearfix header">
  <div class="header-left">
    <div class="payslip-title">
      Payslip <span class="month">{{ \App\Support\MonthYear::start($monthYear)->format('F Y') }}</span>
    </div>
    <div class="company-name">{{ $employerName }}</div>
    <div class="company-address">{!! $companyAddress !!}</div>
  </div>
  <div class="header-right">
    @if($logoBase64)
      <div><img src="{{ $logoBase64 }}" alt="Logo" class="logo-img"></div>
    @endif
    {{--
      The period, the pay date and a reference to quote. A slip that named only
      a month could not be told apart from a correction for the same month, and
      an employee querying one had nothing to cite.
    --}}
    <div class="doc-meta">
      <div><span class="k">Pay period</span> {{ $payPeriod }}</div>
      @if($payDate)
        <div><span class="k">Pay date</span> {{ $payDate }}</div>
      @endif
      <div><span class="k">Reference</span> {{ $slipReference }}</div>
    </div>
  </div>
</div>

<div class="hr"></div>

{{--
  Only shown when something is genuinely unsettled, and it says what.
  This used to print on every payslip unconditionally, disbursed months
  included — a document that always calls itself provisional never means it.
--}}
@if($isProvisional)
<div class="notice">
  <div class="notice-title">Provisional</div>
  @foreach($provisionalReasons as $reason)
    <div class="notice-reason">{{ $reason }}</div>
  @endforeach
</div>
@endif

<!-- ════════════ EMPLOYEE ════════════ -->
<div class="employee-name-bar">{{ $employeeName }}</div>
<div class="hr-thin"></div>

{{--
  Four to a row, and only fields that have a value — an em-dash is not data.
--}}
<table class="info-grid">
  @foreach(array_chunk($identityFields, 4) as $row)
  <tr>
    @foreach($row as $field)
    <td>
      <div class="label">{{ $field['label'] }}</div>
      <div class="value">{{ $field['value'] }}</div>
    </td>
    @endforeach
    @for($i = count($row); $i < 4; $i++)
      <td></td>
    @endfor
  </tr>
  @endforeach
</table>

<!-- ════════════ MONTHLY SALARY ════════════ -->
{{--
  The contracted monthly rate. Loss of pay used to be subtracted here as well as
  appearing in the deductions column — the same reduction printed twice, once as
  a running subtraction and once as a line item. It is a deduction, so it is
  shown once, in the deductions column, where Total Deductions (B) counts it.
--}}
<div class="salary-row">
  <div class="label">Monthly Salary</div>
  <div class="value">₹ {{ number_format($grossFullMonth, 2) }}</div>
</div>
<div class="hr-thin"></div>

<!-- ════════════ SALARY DETAILS ════════════ -->
<div class="section-title">Salary Details</div>
<table class="salary-details">
  <tr>
    {{--
      Four distinct facts that reconcile: Paid Days + Loss Of Pay Days =
      Days In Wage Period. "Actual Payable Days" and "Days Payable" were two
      labels bound to the same value, and neither agreed with the working-day
      count beside them.
    --}}
    <td>
      <div class="label">Days In Wage Period</div>
      <div class="value">{{ $totalDays }}</div>
    </td>
    <td>
      <div class="label">Scheduled Working Days</div>
      <div class="value">{{ $workingDays }}</div>
    </td>
    <td>
      <div class="label">Loss Of Pay Days</div>
      <div class="value">{{ $lopDays }}</div>
    </td>
    <td>
      <div class="label">Paid Days</div>
      <div class="value">{{ $paidDays }}</div>
    </td>
  </tr>
</table>
{{-- Which of those four numbers actually prices a day of absence. --}}
<div class="basis-note">{{ $payBasisNote }}</div>

<!-- ════════════ EARNINGS & DEDUCTIONS ════════════ -->
{{--
  Equal widths with a spacer column between them, and both lists padded to a
  common length by the service so "Total Earnings (A)" and "Total Deductions
  (B)" land on the same baseline. A padded row is null — never a 0.00, which
  in a column of real deductions reads as a deduction.
--}}
<table class="columns-table">
  <tr>
    <td class="col-earnings">
      <div class="section-title">Earnings</div>
      <table class="comp-list">
        @forelse($earningsRows as $comp)
          @if($comp === null)
        <tr class="spacer-row"><td>&nbsp;</td><td class="amt">&nbsp;</td></tr>
          @else
        <tr>
          <td>{{ $comp['label'] }}</td>
          <td class="amt">{{ number_format($comp['amount'], 2) }}</td>
        </tr>
          @endif
        @empty
        <tr class="empty-row"><td colspan="2">No earnings</td></tr>
        @endforelse
        <tr class="total-row">
          <td>Total Earnings (A)</td>
          <td class="amt">{{ number_format($grossSalary, 2) }}</td>
        </tr>
      </table>
    </td>

    <td class="col-gutter">&nbsp;</td>

    <td class="col-deductions">
      <div class="section-title">Taxes &amp; Deductions</div>
      <table class="comp-list">
        @forelse($deductionsRows as $comp)
          @if($comp === null)
        <tr class="spacer-row"><td>&nbsp;</td><td class="amt">&nbsp;</td></tr>
          @else
        <tr>
          <td>{{ $comp['label'] }}</td>
          <td class="amt">{{ number_format($comp['amount'], 2) }}</td>
        </tr>
          @endif
        @empty
        <tr class="empty-row"><td colspan="2">No deductions</td></tr>
        @endforelse
        <tr class="total-row">
          <td>Total Deductions (B)</td>
          <td class="amt">{{ number_format($totalDeductions, 2) }}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- ════════════ NET PAY ════════════ -->
<div class="net-pay-box">
  <table style="width:100%">
    <tr>
      <td style="width:58%">
        <div class="net-pay-label">Net Salary Payable (A &minus; B)</div>
      </td>
      <td style="width:42%">
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
  <div>{{ $slipReference }} &bull; Generated on: {{ $generatedAt }} &bull; &copy; {{ date('Y') }} {{ $employerName }}. All rights reserved.</div>
</div>

</body>
</html>
