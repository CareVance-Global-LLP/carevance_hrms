{{--
  EPF Form 2 — nomination and declaration.

  Every member has to nominate somebody for the Provident Fund and, separately,
  declare family for the Pension Scheme. A missing nomination is the single most
  common cause of a death claim being stuck for months, which is why this form
  is generated as a schedule to chase rather than filed and forgotten.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 2',
  'formSubtitle' => 'Nomination and declaration form for unexempted establishments<br/>Employees’ Provident Funds Scheme, 1952 (paragraph 33 and 61(1)) and Employees’ Pension Scheme, 1995 (paragraph 18)',
])

<h2>Members and their identifiers</h2>

@if(empty($entries))
  <p class="empty">No employees on this payroll run.</p>
@else
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Member</th>
      <th>UAN</th>
      <th>ESI IP number</th>
      <th>PAN</th>
      <th>Department</th>
      <th>Date of joining</th>
      <th class="num">Monthly wages (₹)</th>
    </tr>
  </thead>
  <tbody>
    @foreach($entries as $i => $entry)
      <tr>
        <td>{{ $i + 1 }}</td>
        <td>{{ $entry['employee'] }}</td>
        {{-- Shown as missing rather than blank, on every identifier: a blank
             cell reads as "nothing to see" where the truth is "this member
             cannot be processed until it is filled in". --}}
        <td>{{ $entry['uan'] !== '' ? $entry['uan'] : 'Not on record' }}</td>
        <td>{{ $entry['esi_ip'] !== '' ? $entry['esi_ip'] : 'Not on record' }}</td>
        <td>{{ $entry['pan'] !== '' ? $entry['pan'] : 'Not on record' }}</td>
        <td>{{ $entry['department'] ?: '—' }}</td>
        <td>{{ $entry['joining_date'] ?: '—' }}</td>
        <td class="num">{{ number_format($entry['gross_salary'], 2) }}</td>
      </tr>
    @endforeach
  </tbody>
</table>

<h2>Nomination — Part A (Provident Fund)</h2>
<p class="note">
  To be completed BY THE MEMBER. Each nominee’s name, address, relationship, date of
  birth and share must be given, and the shares must total one whole.
</p>
<table>
  <thead>
    <tr><th>Nominee</th><th>Address</th><th>Relationship</th><th>Date of birth</th><th class="num">Share</th></tr>
  </thead>
  <tbody>
    @for($row = 0; $row < 3; $row++)
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    @endfor
  </tbody>
</table>

<h2>Declaration — Part B (Pension Scheme)</h2>
<p class="note">
  Particulars of family as defined in paragraph 2(vii) of the Employees’ Pension
  Scheme, 1995. Where a member has no family, a nomination may be made in favour of
  another person and stands cancelled if a family is later acquired.
</p>
<table>
  <thead>
    <tr><th>Name</th><th>Address</th><th>Date of birth</th><th>Relationship</th></tr>
  </thead>
  <tbody>
    @for($row = 0; $row < 3; $row++)
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    @endfor
  </tbody>
</table>
@endif

@include('filings._form_foot')
