@if ($stage === 'granted')
SUPPORT HAS TEMPORARY ACCESS TO {{ strtoupper($organizationName) }}

{{ $engineerName }} can now act as {{ $targetName }} in your CareVance account.
@else
SUPPORT IS REQUESTING ACCESS TO {{ strtoupper($organizationName) }}

{{ $engineerName }} has asked to act as {{ $targetName }} in your CareVance account.
Nobody has access until an administrator in your organisation approves it.
@endif

Reason given: {{ $reason }}
Requested:    {{ optional($requestedAt)->format('d M Y, H:i') }}
@if ($expiresAt)
Access ends:  {{ $expiresAt->format('d M Y, H:i') }}
@endif

Access always ends by itself within {{ $maxMinutes }} minutes. Everything done during
the session is recorded against it in your audit log, and you can end it at any
moment from Settings > Security.

If you were not expecting this, revoke the session and contact us. Support will
never ask you to approve access over the phone.
