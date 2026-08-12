<x-mail.layout
    preheader="Choose a new password for your CareVance account."
    eyebrow="CareVance"
    heading="Reset your password"
    :subheading="'Hi '.($name ?: 'there').', we received a password reset request for '.$email.'.'"
    :footerNote="'If you did not request this change, you can ignore this email or contact '.$supportEmail.'.'"
>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4E565D;">
        Use the secure link below to choose a new password.
    </p>

    <x-mail.button :url="$resetUrl">Reset password</x-mail.button>

    <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#6B757D;">
        If the button doesn't work, paste this into your browser:
    </p>
    <p style="margin:8px 0 0;word-break:break-all;font-size:13px;line-height:1.7;">
        <a href="{{ $resetUrl }}" style="color:#3D656B;text-decoration:underline;">{{ $resetUrl }}</a>
    </p>

</x-mail.layout>
