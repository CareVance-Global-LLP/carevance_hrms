{{--
  EPF Form 31 — application for an advance from the Provident Fund.

  Unlike Form 19 this is for SERVING members, so it lists the run's current
  employees. Eligibility depends on length of service and the purpose of the
  advance, neither of which this system decides — the form is a schedule of who
  could apply, not a determination that they may.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 31',
  'formSubtitle' => 'Application for advance from the Provident Fund<br/>Employees’ Provident Funds Scheme, 1952 — paragraph 68',
])

<h2>Serving members</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Member</th>
      <th>PAN</th>
      <th>Designation</th>
      <th>Date of joining</th>
      <th>Status</th>
      <th class="num">Monthly wages (₹)</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record' }}</td>
        <td>{{ $entry['designation'] ?: '—' }}</td>
        <td>{{ $entry['joining_date'] ?: '—' }}</td>
        <td>{{ $entry['employment_status'] ?: '—' }}</td>
        <td class="num">{{ number_format($entry['gross_salary'], 2) }}</td>
      </tr>
    @endforeach
  </tbody>
</table>

<p class="note">
  {{-- Said plainly, because a schedule of names can otherwise read as an
       approval. --}}
  This schedule does not certify eligibility. The permissible amount and purpose of
  an advance are governed by paragraph 68 and are decided on each member’s own
  application.
</p>
@endif

@include('filings._form_foot')
