<x-mail.layout
    :preheader="'Your '.$organizationName.' workspace is ready — sign in with the temporary password inside.'"
    eyebrow="{{ config('brand.product_label') }}"
    heading="Welcome to '.config('brand.label').'"
    :subheading="'Hello '.$userName.', your workspace for '.$organizationName.' has been created and is ready to use.'"
    :footerNote="'Need help? Contact '.$supportEmail.'. © '.date('Y').' {{ config('brand.label') }}. All rights reserved.'"
>

    <x-mail.panel
        label="Your plan"
        :rows="[
            'Plan' => $planName,
            'Seats' => $seats.' users',
        ]"
    />

    <p style="margin:26px 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3D656B;">
        Your login credentials
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #E4E8EB;">
        <tr>
            <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:13px;color:#6B757D;">Email</p>
                <p style="margin:4px 0 14px;font-size:14px;font-weight:700;color:#16191C;">{{ $userEmail }}</p>
                <p style="margin:0;font-size:13px;color:#6B757D;">Temporary password</p>
                <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#16191C;font-family:Consolas,'Courier New',monospace;letter-spacing:0.04em;">{{ $tempPassword }}</p>
            </td>
        </tr>
    </table>

    <p style="margin:22px 0 20px;font-size:15px;line-height:1.7;color:#4E565D;">
        Sign in to start using your workspace:
    </p>

    <x-mail.button :url="$loginUrl">Log in to your workspace</x-mail.button>

    {{-- Amber, not the brand palette: this is a security instruction, and it
         needs to read as a warning rather than as more chrome. --}}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FDF8EF;border-left:4px solid #C8923A;">
        <tr>
            <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#684A1C;">
                    <strong>Important:</strong> change this password after your first login, from Profile Settings.
                </p>
            </td>
        </tr>
    </table>

    <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#6B757D;">
        If the button doesn't work, paste this into your browser:
    </p>
    <p style="margin:8px 0 0;word-break:break-all;font-size:13px;line-height:1.7;">
        <a href="{{ $loginUrl }}" style="color:#3D656B;text-decoration:underline;">{{ $loginUrl }}</a>
    </p>

</x-mail.layout>
