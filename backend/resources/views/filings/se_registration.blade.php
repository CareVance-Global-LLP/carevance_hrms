{{--
  Shops and Establishments registration.

  State legislation, so the particulars differ between states and the form
  cannot claim to be any one state's. It is a preparation sheet: everything the
  employer will be asked for, gathered in one place, with the state-specific
  parts left for them.
--}}
@include('filings._form_head', [
  'formTitle' => 'Shops and Establishments registration',
  'formSubtitle' => 'Application for registration of an establishment<br/>Under the applicable State Shops and Establishments Act',
])

<h2>Establishment</h2>

<table>
  <tr><th style="width:34%">Name of establishment</th><td>{{ $entries[0]['organization_name'] ?? ($employer->name ?? '—') }}</td></tr>
  <tr><th>Postal address</th><td>{{ $employer->address ?? '' }}</td></tr>
  <tr><th>Category of establishment</th><td>&nbsp;</td></tr>
  <tr><th>Nature of business</th><td>&nbsp;</td></tr>
  <tr><th>Date of commencement</th><td>&nbsp;</td></tr>
  <tr><th>Employer’s name and address</th><td>&nbsp;</td></tr>
  <tr><th>Manager’s name, if any</th><td>&nbsp;</td></tr>
  <tr><th>Number of employees</th><td>&nbsp;</td></tr>
  <tr><th>Weekly closing day</th><td>&nbsp;</td></tr>
  <tr><th>Working hours</th><td>&nbsp;</td></tr>
</table>

<p class="note">
  The Shops and Establishments Acts are STATE legislation and their particulars,
  fees and renewal periods differ. This sheet gathers what every state asks for; the
  application itself is made to the authority for the state in which the
  establishment sits, on that state’s own form.
</p>

@include('filings._form_foot')
