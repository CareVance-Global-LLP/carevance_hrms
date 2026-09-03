<x-mail.layout
    :preheader="$bugReport->issue_category.' — '.$bugReport->summary"
    eyebrow="{{ config('brand.label') }} support"
    heading="New bug report received"
    footerLead="<strong style='color:#16191C;'>{{ config('brand.label') }}</strong> — internal support notification."
>

    <x-mail.panel
        label="Reporter"
        :rows="[
            'Name' => $bugReport->name ?: 'Not provided',
            'Email' => $bugReport->email,
            'Category' => $bugReport->issue_category,
            'Route' => $bugReport->current_path ?: 'Not provided',
        ]"
    />

    <p style="margin:26px 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3D656B;">
        Summary
    </p>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#16191C;">{{ $bugReport->summary }}</p>

    <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3D656B;">
        Description
    </p>
    <p style="margin:0;font-size:14px;line-height:1.7;color:#16191C;white-space:pre-line;">{{ $bugReport->description }}</p>

</x-mail.layout>
