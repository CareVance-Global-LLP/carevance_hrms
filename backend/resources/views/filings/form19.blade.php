{{--
  EPF Form 19 — claim for final settlement of the Provident Fund.

  Filed by a member who has LEFT. So this form is driven by full-and-final
  settlements rather than by the payroll run's employees, and an empty list is a
  perfectly ordinary month rather than a fault — most months nobody leaves, and
  a form that looked broken when nothing happened would train people to ignore
  it in the month somebody did.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 19',
  'formSubtitle' => 'Claim for final settlement of Provident Fund<br/>Employees’ Provident Funds Scheme, 1952 — paragraph 72(5)',
])

<h2>Members claiming settlement</h2>

@if(empty($entries))
  <p class="empty">No employee left during this period, so there is nothing to settle.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Member</th>
      <th>UAN</th>
      <th>PAN</th>
      <th>Last working day</th>
      <th>Reason for leaving</th>
      <th class="num">Gratuity (₹)</th>
      <th class="num">Net settlement (₹)</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        {{-- A missing UAN is shown as missing rather than blank: the claim
             cannot be filed without one, and a blank cell reads as "nothing to
             see" instead of "this will be rejected". --}}
        <td>{{ $entry['uan'] !== '' ? $entry['uan'] : 'Not on record' }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record' }}</td>
        <td>{{ $entry['last_working_date'] ?: '—' }}</td>
        <td>{{ $entry['exit_type'] ?: '—' }}</td>
        <td class="num">{{ number_format($entry['gratuity'], 2) }}</td>
        <td class="num">{{ number_format($entry['net_settlement'], 2) }}</td>
      </tr>
    @endforeach
    <tr class="grand">
      <td colspan="6">Total — {{ count($entries) }} member(s)</td>
      <td class="num">{{ number_format($totalGratuity ?? 0, 2) }}</td>
      <td class="num">{{ number_format($totalSettlement ?? 0, 2) }}</td>
    </tr>
  </tbody>
</table>

<p class="note">
  Settlement is payable only after the statutory waiting period. Where a member has
  completed ten years of eligible service, pension under the Employees’ Pension
  Scheme is claimed on Form 10C rather than here.
</p>
@endif

@include('filings._form_foot')
