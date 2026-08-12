{{--
    The call to action.

    The colour sits on the <td>, never on the <a>. Outlook's Word engine will
    not honour padding or a background on an inline anchor, so the old
    `<a style="padding:14px 24px;background:...">` rendered as a naked blue
    link there. Padding on a table cell it does honour, which is why this shape
    needs no VML fallback — and it stays square-cornered, matching the app.
--}}
@props([
    'url',
    'color' => '#305056',
])
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;">
    <tr>
        <td bgcolor="{{ $color }}" style="background-color:{{ $color }};padding:14px 26px;">
            <a href="{{ $url }}" style="color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;display:block;">{{ $slot }}</a>
        </td>
    </tr>
</table>
