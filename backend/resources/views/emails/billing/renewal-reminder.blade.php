@php
    $headline = $daysRemaining <= 1
        ? 'Your plan renews tomorrow'
        : 'Your plan renews in '.$daysRemaining.' days';
@endphp

<x-mail.layout
    :preheader="$organization->name.' renews on '.$renewalDate.' — '.($autoRenew ? 'no action needed.' : 'auto-renew is off.')"
    eyebrow="CareVance billing"
    :heading="$headline"
    footerNote="You are receiving this because you administer this CareVance workspace. Reminders are sent 7, 3 and 1 day before each renewal."
>

    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#4E565D;">Hello,</p>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4E565D;">
        The subscription for <strong style="color:#16191C;">{{ $organization->name }}</strong>
        is due for renewal on <strong style="color:#16191C;">{{ $renewalDate }}</strong>,
        covering {{ $seats }} {{ \Illuminate\Support\Str::plural('seat', $seats) }}.
    </p>

    @if ($autoRenew)
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#4E565D;">
            Auto-renew is on, so no action is needed — we will charge the saved mandate on the
            renewal date and email you the receipt.
        </p>
    @else
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#4E565D;">
            Auto-renew is off, so this will not be charged automatically. If the renewal date
            passes without payment, the workspace stays fully usable for a further
            {{ \App\Services\Billing\SubscriptionCycleService::GRACE_DAYS }} days, and then becomes
            read-only until payment clears. Nothing is deleted at any point.
        </p>
    @endif

    <x-mail.button :url="$billingUrl">{{ $autoRenew ? 'Review billing' : 'Renew now' }}</x-mail.button>

</x-mail.layout>
