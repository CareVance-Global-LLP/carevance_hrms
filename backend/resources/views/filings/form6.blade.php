{{--
  ESI Form 6 — the register of employees.

  Regulation 32 requires an employer to keep a register of every employee, the
  wages paid and the contributions on them. It is the document an ESIC inspector
  asks for first, and it is checked against the challans, so the totals here are
  taken from the run rather than recomputed.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 6',
  'formSubtitle' => 'Register of employees<br/>Employees’ State Insurance (General) Regulations, 1950 — regulation 32',
])

<h2>Employees, wages and contributions</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Employee</th>
      <th>PAN</th>
      <th class="num">Gross wages (₹)</th>
      <th class="num">PF — employee (₹)</th>
      <th class="num">PF — employer (₹)</th>
      <th class="num">ESI — employee (₹)</th>
      <th class="num">ESI — employer (₹)</th>
      <th class="num">TDS (₹)</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record' }}</td>
        <td class="num">{{ number_format($entry['gross_salary'], 2) }}</td>
        <td class="num">{{ number_format($entry['pf_employee'], 2) }}</td>
        <td class="num">{{ number_format($entry['pf_employer'], 2) }}</td>
        <td class="num">{{ number_format($entry['esi_employee'], 2) }}</td>
        <td class="num">{{ number_format($entry['esi_employer'], 2) }}</td>
        <td class="num">{{ number_format($entry['tds'], 2) }}</td>
      </tr>
    @endforeach
    <tr class="grand">
      <td colspan="3">Total — {{ count($entries) }} employee(s)</td>
      {{-- From the run's own totals, not re-added here. Two places computing
           the same figure is how a register stops matching its challan. --}}
      <td class="num">{{ number_format($totals['gross'] ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totals['pf_employee'] ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totals['pf_employer'] ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totals['esi_employee'] ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totals['esi_employer'] ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totals['tds'] ?? 0, 2) }}</td>
    </tr>
  </tbody>
</table>

<p class="note">
  An employee whose wages exceed the coverage ceiling remains covered until the end
  of the contribution period in which they crossed it.
</p>
@endif

@include('filings._form_foot')
