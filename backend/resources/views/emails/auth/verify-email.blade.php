<x-mail.layout
    preheader="Confirm your address to finish setting up your {{ config('brand.label') }} account."
    eyebrow="{{ config('brand.label') }}"
    heading="Verify your email address"
    :subheading="'Hi '.($name ?: 'there').', confirm '.$email.' so your workspace account is fully verified.'"
    :footerNote="'If you did not create this account, contact '.$supportEmail.'.'"
>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4E565D;">
        Select the button below to verify your email. This link is time-limited for security.
    </p>

    <x-mail.button :url="$verificationUrl">Verify email</x-mail.button>

    <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#6B757D;">
        If the button doesn't work, paste this into your browser:
    </p>
    <p style="margin:8px 0 0;word-break:break-all;font-size:13px;line-height:1.7;">
        <a href="{{ $verificationUrl }}" style="color:#3D656B;text-decoration:underline;">{{ $verificationUrl }}</a>
    </p>

</x-mail.layout>
