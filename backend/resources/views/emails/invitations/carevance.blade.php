{{--
    The invitation a new joiner receives.

    Employer-first on purpose: the recipient has an employment relationship with
    the organisation and usually none at all with CareVance, so the org name
    leads the eyebrow, the headline and the subject. CareVance appears once, as
    the platform their employer runs on, in the footer.
--}}
<x-mail.layout
    :preheader="'Set your password and your '.$organizationName.' account is ready — this invite expires in '.$expiresInHours.' hours.'"
    :eyebrow="$organizationName"
    :heading="'You\'re joining '.e($organizationName)"
    :subheading="$inviterName
        ? $inviterName.($inviterRoleLabel ? ' ('.$inviterRoleLabel.')' : '').' has invited you to set up your account.'
        : 'You have been invited to set up your account.'"
    :footerLead="'<strong style=\'color:#16191C;\'>CareVance</strong> — the HR &amp; payroll platform '.e($organizationName).' runs on.'"
    :footerNote="'You\'re receiving this because someone at '.$organizationName.' added '.$email.'. Not expecting it? Ignore this email, or write to '.$supportEmail.'.'"
>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4E565D;">
        {{ $organizationName }} runs its HR and payroll on CareVance. Set a password and your account is ready to use.
    </p>

    <x-mail.button :url="$acceptUrl">Accept invitation &amp; set password</x-mail.button>

    <x-mail.panel
        label="Your invitation"
        :rows="[
            'Organisation' => $organizationName,
            'Job title' => $jobTitle,
            'Access role' => $roleLabel,
            'Start date' => $joiningDate,
            'Invited by' => $inviterName,
            'Expires' => $expiresAtLabel,
        ]"
    />

    <p style="margin:26px 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3D656B;">
        What happens next
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4E565D;">
        <tr>
            <td width="24" valign="top" style="padding:3px 0;color:#3D656B;font-weight:700;">1</td>
            <td style="padding:3px 0;">Set your password on the CareVance sign-in page.</td>
        </tr>
        <tr>
            <td width="24" valign="top" style="padding:3px 0;color:#3D656B;font-weight:700;">2</td>
            <td style="padding:3px 0;">Add your profile, bank and PAN details so payroll can run.</td>
        </tr>
        <tr>
            <td width="24" valign="top" style="padding:3px 0;color:#3D656B;font-weight:700;">3</td>
            <td style="padding:3px 0;">
                @if ($inviterName)
                    {{ $inviterName }} and the {{ $organizationName }} HR team take it from there.
                @else
                    The {{ $organizationName }} HR team takes it from there.
                @endif
            </td>
        </tr>
    </table>

    <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#6B757D;">
        This link is personal and single-use — please don't forward it. If the button doesn't work, paste this into your browser:
    </p>
    <p style="margin:8px 0 0;word-break:break-all;font-size:13px;line-height:1.7;">
        <a href="{{ $acceptUrl }}" style="color:#3D656B;text-decoration:underline;">{{ $acceptUrl }}</a>
    </p>

</x-mail.layout>
