{{--
    The tinted detail box. Pass rows as a keyed array and it renders a label /
    value table; anything falsy in a value is skipped, so a caller can hand over
    optional fields (job title, joining date) without guarding each one.
--}}
@props([
    'label' => null,
    'rows' => [],
])
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F0F7F8;border:1px solid #D9EBED;">
    <tr>
        <td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">
            @if ($label)
                <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#3D656B;">{{ $label }}</p>
            @endif

            @if (! empty($rows))
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;line-height:1.7;color:#4E565D;font-family:Arial,Helvetica,sans-serif;">
                    @foreach ($rows as $key => $value)
                        @continue(blank($value))
                        <tr>
                            <td style="padding:2px 0;width:112px;color:#6B757D;" valign="top">{{ $key }}</td>
                            <td style="padding:2px 0;color:#16191C;font-weight:700;" valign="top">{{ $value }}</td>
                        </tr>
                    @endforeach
                </table>
            @endif

            {{ $slot }}
        </td>
    </tr>
</table>
