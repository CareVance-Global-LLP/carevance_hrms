{{--
  e-SHRAM registration schedule.

  e-SHRAM is the national database of UNORGANISED workers, and eligibility turns
  on not being an EPFO or ESIC member. So a list of payroll employees is a
  candidate list rather than a filing: most people on it will be ineligible
  precisely because this system is paying their PF.

  That is worth saying on the form. A schedule that looked like a return would
  have somebody registering their whole payroll into the wrong database.
--}}
@include('filings._form_head', [
  'formTitle' => 'e-SHRAM registration',
  'formSubtitle' => 'National Database of Unorganised Workers — candidate schedule<br/>Ministry of Labour and Employment',
])

<h2>Workers to assess</h2>

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
      <th>Likely eligible</th>
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
        {{-- Stated as a likelihood, not a determination. Holding a UAN means
             EPFO membership, which excludes somebody from e-SHRAM — but the
             assessment is the registering authority's, not ours. --}}
        <td>{{ $entry['uan'] !== '' ? 'No — EPFO member' : 'Assess' }}</td>
      </tr>
    @endforeach
  </tbody>
</table>

<p class="note">
  e-SHRAM covers UNORGANISED workers. A member of EPFO or ESIC is not eligible, and
  most people on a payroll that deducts PF will therefore be excluded. This schedule
  is for assessing who might qualify — it is not itself a registration or a return.
</p>
@endif

@include('filings._form_foot')
