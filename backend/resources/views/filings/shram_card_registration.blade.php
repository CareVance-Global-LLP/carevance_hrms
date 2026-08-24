{{--
  Shram card schedule.

  The card issued off an e-SHRAM registration, carrying the Universal Account
  Number for unorganised workers. Same caveat as e-SHRAM and for the same
  reason: this is a working list, not a return, and it says so.
--}}
@include('filings._form_head', [
  'formTitle' => 'Shram card',
  'formSubtitle' => 'Shram card issue and update schedule<br/>National Database of Unorganised Workers',
])

<h2>Workers</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Worker</th>
      <th>UAN</th>
      <th>PAN</th>
      <th>Date of joining</th>
      <th class="num">Monthly wages (₹)</th>
      <th>Card number</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        <td>{{ $entry['uan'] !== '' ? $entry['uan'] : '—' }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : '—' }}</td>
        <td>{{ $entry['joining_date'] ?: '—' }}</td>
        <td class="num">{{ number_format($entry['gross_salary'], 2) }}</td>
        {{-- Left for the employer to fill in. A card number this system has
             never seen must not be invented into a statutory schedule. --}}
        <td>&nbsp;</td>
      </tr>
    @endforeach
  </tbody>
</table>

<p class="note">
  A shram card is issued on e-SHRAM registration, which is open to unorganised
  workers only. Card numbers are left blank because this system does not hold them,
  and a statutory schedule carrying an invented identifier is worse than an empty
  column.
</p>
@endif

@include('filings._form_foot')
