{{--
    The text/plain alternative.

    Rendered with {!! !!} throughout: Blade's default escaping would turn an
    organisation called "Smith & Co" into "Smith &amp; Co" in a part that has no
    HTML to escape into.
--}}
You're joining {!! $organizationName !!}
------------------------------------------------------------

@if ($inviterName){!! $inviterName !!}@if ($inviterRoleLabel) ({!! $inviterRoleLabel !!})@endif has invited you to set up your account.
@else
You have been invited to set up your account.
@endif
{!! $organizationName !!} runs its HR and payroll on {{ config('brand.label') }}.

Accept your invitation and set a password:
{!! $acceptUrl !!}

YOUR INVITATION
  Organisation   {!! $organizationName !!}
@if ($jobTitle)  Job title      {!! $jobTitle !!}
@endif
  Access role    {!! $roleLabel !!}
@if ($joiningDate)  Start date     {!! $joiningDate !!}
@endif
@if ($inviterName)  Invited by     {!! $inviterName !!}
@endif
  Expires        {!! $expiresAtLabel !!}

WHAT HAPPENS NEXT
  1. Set your password on the {{ config('brand.label') }} sign-in page.
  2. Add your profile, bank and PAN details so payroll can run.
  3. @if ($inviterName){!! $inviterName !!} and the {!! $organizationName !!} HR team take it from there.@else The {!! $organizationName !!} HR team takes it from there.@endif


This link is personal and single-use - please don't forward it.

------------------------------------------------------------
{{ config('brand.label') }} - the HR and payroll platform {!! $organizationName !!} runs on.
You're receiving this because someone at {!! $organizationName !!} added {!! $email !!}.
Not expecting it? Ignore this email, or write to {!! $supportEmail !!}.
