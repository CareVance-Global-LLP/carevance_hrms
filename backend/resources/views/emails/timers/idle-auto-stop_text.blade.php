Your timer was stopped
------------------------------------------------------------

Hi {!! $userName ?: 'there' !!},

Your running timer in {!! $organizationName !!} was stopped automatically
because you were idle for {!! $idleDurationLabel !!}.

AUTO-STOP DETAILS
  Idle for     {!! $idleDurationLabel !!}
  Stopped at   {!! $stoppedAt->copy()->timezone($displayTimezone)->format('j M Y, g:i A T') !!}

Reopen the desktop app and start the timer again when you return.

------------------------------------------------------------
{{ config('brand.label') }} - HR and payroll, in one place.
