{{--
  Form 124 — tax deducted at source, per employee, for the period.

  A schedule that reconciles against the 24Q return and the challans. The point
  of producing it separately is that somebody can check one employee's figure
  without opening a quarterly return.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 124',
  'formSubtitle' => 'Statement of tax deducted at source from salary',
])

<h2>Deductions</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Employee</th>
      <th>PAN</th>
      <th class="num">Gross salary (₹)</th>
      <th class="num">Tax deducted (₹)</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        {{-- A missing PAN is not cosmetic here: without one, tax is deductible
             at the higher of the normal rate or 20% under section 206AA, so it
             is called out rather than left blank. --}}
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record — s.206AA applies' }}</td>
        <td class="num">{{ number_format($entry['gross_salary'], 2) }}</td>
        <td class="num">{{ number_format($entry['tds'], 2) }}</td>
      </tr>
    @endforeach
    <tr class="grand">
      <td colspan="3">Total — {{ count($entries) }} employee(s)</td>
      <td class="num">{{ number_format(collect($entries)->sum('gross_salary'), 2) }}</td>
      <td class="num">{{ number_format(collect($entries)->sum('tds'), 2) }}</td>
    </tr>
  </tbody>
</table>
@endif

@include('filings._form_foot')
