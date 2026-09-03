<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{{ config('brand.label') }} support access</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:28px;">

    <h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;">
      @if ($stage === 'granted')
        Support has temporary access to {{ $organizationName }}
      @else
        Support is requesting access to {{ $organizationName }}
      @endif
    </h1>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
      @if ($stage === 'granted')
        {{ $engineerName }} can now act as <strong>{{ $targetName }}</strong> in your {{ config('brand.label') }} account.
      @else
        {{ $engineerName }} has asked to act as <strong>{{ $targetName }}</strong> in your {{ config('brand.label') }} account.
        Nobody has access until an administrator in your organisation approves it.
      @endif
    </p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;width:120px;">Reason given</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">{{ $reason }}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Requested</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">{{ optional($requestedAt)->format('d M Y, H:i') }}</td>
      </tr>
      @if ($expiresAt)
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Access ends</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;"><strong>{{ $expiresAt->format('d M Y, H:i') }}</strong></td>
      </tr>
      @endif
    </table>

    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#334155;">
      Access always ends by itself within {{ $maxMinutes }} minutes. Everything done during the
      session is recorded against it in your audit log, and you can end it at any moment from
      Settings &rsaquo; Security.
    </p>

    <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
      If you were not expecting this, revoke the session and contact us. Support will never ask
      you to approve access over the phone.
    </p>
  </div>
</body>
</html>
