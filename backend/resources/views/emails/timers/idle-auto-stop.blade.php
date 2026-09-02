<x-mail.layout
    :preheader="'Your timer in '.$organizationName.' stopped after '.$idleDurationLabel.' idle.'"
    eyebrow="{{ config('brand.label') }}"
    heading="Your timer was stopped"
    :subheading="'Hi '.($userName ?: 'there').', your running timer in '.$organizationName.' was stopped automatically because you were idle for '.$idleDurationLabel.'.'"
>

    <x-mail.panel
        label="Auto-stop details"
        :rows="[
            'Idle for' => $idleDurationLabel,
            'Stopped at' => $stoppedAt->copy()->timezone($displayTimezone)->format('j M Y, g:i A T'),
        ]"
    />

    <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#6B757D;">
        Reopen the desktop app and start the timer again when you return.
    </p>

</x-mail.layout>
