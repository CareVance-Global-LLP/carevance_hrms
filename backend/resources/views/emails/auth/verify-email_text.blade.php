Verify your email address
------------------------------------------------------------

Hi {!! $name ?: 'there' !!},

Confirm {!! $email !!} so your {{ config('brand.label') }} workspace account is fully
verified. This link is time-limited for security.

{!! $verificationUrl !!}

------------------------------------------------------------
{{ config('brand.label') }} - HR and payroll, in one place.
If you did not create this account, contact {!! $supportEmail !!}.
