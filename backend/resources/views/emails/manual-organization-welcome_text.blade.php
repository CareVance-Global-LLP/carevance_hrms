Welcome to {{ config('brand.label') }}
------------------------------------------------------------

Hello {!! $userName !!},

Your workspace for {!! $organizationName !!} has been created and is
ready to use.

YOUR PLAN
  Plan    {!! $planName !!}
  Seats   {!! $seats !!} users

YOUR LOGIN CREDENTIALS
  Email               {!! $userEmail !!}
  Temporary password  {!! $tempPassword !!}

IMPORTANT: change this password after your first login, from
Profile Settings.

Sign in here:
{!! $loginUrl !!}

------------------------------------------------------------
{{ config('brand.label') }} - HR and payroll, in one place.
Need help? Contact {!! $supportEmail !!}.
(c) {{ date('Y') }} {{ config('brand.label') }}. All rights reserved.
