{{--
  UAN activation status.

  A UAN that has been allotted but never ACTIVATED is the quiet failure here:
  contributions still flow, so nothing looks wrong from the employer's side, but
  the member cannot see their passbook, cannot file a claim online, and
  discovers it at the worst possible moment. So this form is a chase list, and
  the pending column is the point of it.
--}}
@include('filings._form_head', [
  'formTitle' => 'UAN activation',
  'formSubtitle' => 'Universal Account Number — allotment and activation status<br/>Employees’ Provident Fund Organisation',
])

<h2>Members</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Member</th>
      <th>UAN</th>
      <th>PAN</th>
      <th>Date of joining</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        <td>{{ $entry['uan'] !== '' ? $entry['uan'] : 'Not allotted' }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record' }}</td>
        <td>{{ $entry['joining_date'] ?: '—' }}</td>
        <td>{{ $entry['uan_status'] ?? ($entry['uan'] !== '' ? 'Allotted' : 'Not allotted') }}</td>
      </tr>
    @endforeach
  </tbody>
</table>

<table class="meta-grid">
  <tr><td>Activated</td><td>{{ $activated ?? collect($entries)->where('uan', '!=', '')->count() }}</td></tr>
  <tr><td>Still pending</td><td>{{ $pending ?? collect($entries)->where('uan', '')->count() }}</td></tr>
</table>

<p class="note">
  {{-- The reason this list exists, said plainly. --}}
  Contributions continue to be credited against an inactive UAN, so nothing appears
  wrong from the employer’s side. The member simply cannot view their passbook or
  file a claim online until it is activated.
</p>
@endif

@include('filings._form_foot')
