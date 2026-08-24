{{--
  Form 1 — the establishment's own particulars.

  The generator passes only the organisation, because that is genuinely all this
  form is: a declaration about the establishment rather than a schedule of
  people. The blanks are left blank rather than guessed — a registration form
  pre-filled with an invented number is worse than one an employer completes by
  hand, because nobody checks a field that already looks answered.
--}}
@include('filings._form_head', [
  'formTitle' => 'Form 1',
  'formSubtitle' => 'Particulars of the establishment<br/>To be furnished by the employer on registration',
])

<h2>Establishment</h2>

<table>
  <tr><th style="width:34%">Name of establishment</th><td>{{ $entries[0]['organization_name'] ?? ($employer->name ?? '—') }}</td></tr>
  <tr><th>Address</th><td>{{ $employer->address ?? '' }}</td></tr>
  <tr><th>Nature of business</th><td>&nbsp;</td></tr>
  <tr><th>Date of commencement</th><td>&nbsp;</td></tr>
  <tr><th>Permanent Account Number (PAN)</th><td>&nbsp;</td></tr>
  <tr><th>Provident Fund code</th><td>&nbsp;</td></tr>
  <tr><th>ESI code</th><td>&nbsp;</td></tr>
  <tr><th>Number of employees</th><td>&nbsp;</td></tr>
</table>

<h2>Occupier and manager</h2>

<table>
  <tr><th style="width:34%">Name of occupier</th><td>&nbsp;</td></tr>
  <tr><th>Address of occupier</th><td>&nbsp;</td></tr>
  <tr><th>Name of manager</th><td>&nbsp;</td></tr>
  <tr><th>Address of manager</th><td>&nbsp;</td></tr>
</table>

<p class="note">
  {{-- Said out loud rather than left implied. --}}
  Fields left blank are those this system does not hold and must not invent. A
  registration form carrying a guessed identifier is worse than an empty one,
  because nobody checks a field that already looks answered.
</p>

@include('filings._form_foot')
