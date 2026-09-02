Reset your password
------------------------------------------------------------

Hi {!! $name ?: 'there' !!},

We received a password reset request for {!! $email !!}.
Use the secure link below to choose a new password.

{!! $resetUrl !!}

------------------------------------------------------------
{{ config('brand.label') }} - HR and payroll, in one place.
If you did not request this change, you can ignore this email
or contact {!! $supportEmail !!}.
