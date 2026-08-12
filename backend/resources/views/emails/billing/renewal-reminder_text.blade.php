@php
    $headline = $daysRemaining <= 1
        ? 'Your plan renews tomorrow'
        : 'Your plan renews in '.$daysRemaining.' days';
@endphp
{!! $headline !!}
------------------------------------------------------------

Hello,

The subscription for {!! $organization->name !!} is due for renewal on
{!! $renewalDate !!}, covering {!! $seats !!} {!! \Illuminate\Support\Str::plural('seat', $seats) !!}.

@if ($autoRenew)
Auto-renew is on, so no action is needed - we will charge the saved
mandate on the renewal date and email you the receipt.
@else
Auto-renew is off, so this will not be charged automatically. If the
renewal date passes without payment, the workspace stays fully usable
for a further {!! \App\Services\Billing\SubscriptionCycleService::GRACE_DAYS !!} days, and then becomes read-only until
payment clears. Nothing is deleted at any point.
@endif

{!! $autoRenew ? 'Review billing:' : 'Renew now:' !!}
{!! $billingUrl !!}

------------------------------------------------------------
CareVance - HR and payroll, in one place.
You are receiving this because you administer this CareVance workspace.
Reminders are sent 7, 3 and 1 day before each renewal.
