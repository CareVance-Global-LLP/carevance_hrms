{{--
  The offer letter.

  Rendered by Dompdf, which is the same pipeline payslips and Form 16 use — so
  the constraints are its constraints: no flexbox, no grid, no external assets.
  Tables and inline styles only.

  The signature block at the bottom is present in BOTH states on purpose. An
  unsigned letter shows the space where a signature will go, so the candidate
  reading it knows what is being asked of them; a signed one shows the mark and
  the audit trail beneath it, because a signature with no trail is decoration.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Offer of employment — {{ $candidateName }}</title>
    <style>
        @page { margin: 28mm 20mm; }
        body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #14181c; line-height: 1.6; }
        h1 { font-size: 17px; margin: 0 0 2px; }
        h2 { font-size: 12px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6770; }
        .muted { color: #5b6770; }
        table { width: 100%; border-collapse: collapse; }
        .terms td { padding: 5px 0; vertical-align: top; }
        .terms td.label { width: 45%; color: #5b6770; }
        .terms td.value { font-weight: bold; }
        .rule { border-top: 1px solid #d9dee2; margin: 16px 0; }
        .sign-box { border: 1px solid #d9dee2; padding: 10px; margin-top: 8px; }
        .sign-line { border-bottom: 1px solid #14181c; height: 34px; width: 240px; }
        .audit { font-size: 9px; color: #5b6770; margin-top: 6px; line-height: 1.5; }
        .signed-name { font-family: DejaVu Sans, sans-serif; font-size: 16px; font-style: italic; }
    </style>
</head>
<body>

<table>
    <tr>
        <td>
            <h1>{{ $entityName }}</h1>
            @if ($entityAddress)
                <div class="muted">{{ $entityAddress }}</div>
            @endif
        </td>
        <td style="text-align: right; vertical-align: top;">
            <div class="muted">{{ $issuedOn }}</div>
            <div class="muted">Ref: {{ $reference }}</div>
        </td>
    </tr>
</table>

<div class="rule"></div>

<p>Dear {{ $candidateName }},</p>

<p>
    We are pleased to offer you the position of <strong>{{ $designation }}</strong> at
    {{ $entityName }}. The principal terms are set out below; they are subject to the
    company's policies as they apply from time to time.
</p>

<h2>Terms</h2>

<table class="terms">
    <tr>
        <td class="label">Position</td>
        <td class="value">{{ $designation }}</td>
    </tr>
    <tr>
        <td class="label">Annual cost to company</td>
        {{-- Formatted in the Indian numbering system, because that is how a
             salary is read by the person receiving it. --}}
        <td class="value">₹ {{ $annualCtc }}</td>
    </tr>
    @if ($joiningBonus)
        <tr>
            <td class="label">Joining bonus</td>
            <td class="value">₹ {{ $joiningBonus }}</td>
        </tr>
    @endif
    @if ($joiningDate)
        <tr>
            <td class="label">Proposed date of joining</td>
            <td class="value">{{ $joiningDate }}</td>
        </tr>
    @endif
    @if ($validUntil)
        <tr>
            <td class="label">This offer is open until</td>
            <td class="value">{{ $validUntil }}</td>
        </tr>
    @endif
</table>

<p>
    This offer is made on the basis of the information you have provided, and is
    conditional on your confirming that you are free to take up employment on the
    date above.
</p>

<h2>Acceptance</h2>

@if ($signature)
    <div class="sign-box">
        <div class="signed-name">{{ $signature['signer_name'] }}</div>
        <div class="muted" style="margin-top: 4px;">Accepted electronically</div>

        {{--
          The trail, not the mark, is what makes this worth anything. Anybody
          disputing the signature will ask exactly these four questions.
        --}}
        <div class="audit">
            Signed {{ $signature['signed_at'] }}<br>
            @if ($signature['ip_address'])
                From IP {{ $signature['ip_address'] }}<br>
            @endif
            @if ($signature['document_hash'])
                Document fingerprint (SHA-256): {{ $signature['document_hash'] }}
            @endif
        </div>
    </div>
@else
    <p>
        To accept, please sign using the link that accompanied this letter. Your
        acceptance will be recorded with the date, time and network address from
        which it was made.
    </p>

    <div class="sign-box">
        <div class="muted" style="font-size: 10px;">Signature</div>
        <div class="sign-line"></div>
        <div class="muted" style="font-size: 10px; margin-top: 8px;">Name and date</div>
        <div class="sign-line"></div>
    </div>
@endif

<div class="rule"></div>

<p class="muted" style="font-size: 10px;">
    Issued by {{ $entityName }}{{ $issuerName ? ', for and on behalf of the company by '.$issuerName : '' }}.
</p>

</body>
</html>
