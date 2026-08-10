<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your CareVance plan renews soon</title>
</head>
<body style="margin:0;padding:0;background:#f1f4f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#16191c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f6;padding:32px 12px;">
    <tr>
        <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e8eb;border-radius:12px;overflow:hidden;">
                <tr>
                    <td style="padding:24px 28px 8px;">
                        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6b757d;">
                            CareVance billing
                        </p>
                        <h1 style="margin:10px 0 0;font-size:22px;line-height:1.25;color:#16191c;">
                            @if ($daysRemaining <= 1)
                                Your plan renews tomorrow
                            @else
                                Your plan renews in {{ $daysRemaining }} days
                            @endif
                        </h1>
                    </td>
                </tr>
                <tr>
                    <td style="padding:12px 28px 0;">
                        <p style="margin:0;font-size:15px;line-height:1.6;color:#4e565d;">
                            Hello,
                        </p>
                        <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#4e565d;">
                            The subscription for <strong style="color:#16191c;">{{ $organization->name }}</strong>
                            is due for renewal on <strong style="color:#16191c;">{{ $renewalDate }}</strong>,
                            covering {{ $seats }} {{ \Illuminate\Support\Str::plural('seat', $seats) }}.
                        </p>
                        @if ($autoRenew)
                            <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#4e565d;">
                                Auto-renew is on, so no action is needed — we will charge the saved mandate on
                                the renewal date and email you the receipt.
                            </p>
                        @else
                            <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#4e565d;">
                                Auto-renew is off, so this will not be charged automatically. If the renewal
                                date passes without payment, the workspace stays fully usable for a further
                                {{ \App\Services\Billing\SubscriptionCycleService::GRACE_DAYS }} days, and then
                                becomes read-only until payment clears. Nothing is deleted at any point.
                            </p>
                        @endif
                    </td>
                </tr>
                <tr>
                    <td style="padding:22px 28px 28px;">
                        <a href="{{ $billingUrl }}"
                           style="display:inline-block;background:#3d656b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">
                            {{ $autoRenew ? 'Review billing' : 'Renew now' }}
                        </a>
                        <p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#6b757d;">
                            You are receiving this because you administer this CareVance workspace.
                            Reminders are sent 7, 3 and 1 day before each renewal.
                        </p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
