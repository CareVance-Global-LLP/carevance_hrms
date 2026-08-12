{{--
    The shared shell for every CareVance email.

    Palette is the product's own, from frontend/src/styles/theme.css:
      n-950  #0E1012   n-900 #16191C   n-600 #4E565D   n-500 #6B757D
      n-400  #9AA4AC   n-200 #E4E8EB   n-100 #F1F4F6
      brand-950 #16262B  brand-800 #305056  brand-700 #3D656B
      brand-300 #8DC3C9  brand-100 #D9EBED  brand-50 #F0F7F8
      accent-500 #C8923A (gold — the hairline rail only)

    Three things here are load-bearing and easy to undo by accident:

    1. The banner carries `bgcolor` AND `background-color` under the gradient.
       Outlook renders with the Word engine and drops `linear-gradient`
       entirely; without the solid colour beneath it the white headline lands
       on white and the recipient sees an empty box. That was the live bug.
    2. The MSO conditional wrapper is the only reliable way to hold the card
       at 600px — Outlook ignores `max-width` and stretches edge to edge.
    3. The preheader div controls the inbox preview snippet. Without it the
       client grabs whatever text comes first, which is rarely the useful bit.
--}}
@props([
    'preheader' => '',
    'eyebrow' => 'CareVance',
    'heading' => '',
    'subheading' => null,
    'footerLead' => 'CareVance — HR and payroll, in one place.',
    'footerNote' => null,
])
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    {{-- Apple Mail and Gmail invert an unclaimed palette in dark mode; claiming
         both schemes keeps the white card and dark banner as designed. --}}
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>{{ $heading !== '' ? $heading : 'CareVance' }}</title>
    <!--[if mso]>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
    <![endif]-->
</head>
<body style="margin:0;padding:0;background:#F1F4F6;font-family:Arial,Helvetica,sans-serif;color:#16191C;">

    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F1F4F6;">
        {{ $preheader }}
        {{-- Spacer stops the client padding the snippet with body copy. --}}
        &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F1F4F6;">
        <tr>
            <td align="center" style="padding:32px 16px;">

                <!--[if mso]>
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td>
                <![endif]-->

                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #E4E8EB;">

                    <tr>
                        <td bgcolor="#C8923A" height="4" style="background-color:#C8923A;height:4px;line-height:4px;font-size:0;">&nbsp;</td>
                    </tr>

                    <tr>
                        <td bgcolor="#16191C" style="padding:32px;background-color:#16191C;background-image:linear-gradient(135deg,#0E1012 0%,#16262B 44%,#305056 100%);font-family:Arial,Helvetica,sans-serif;">
                            @if ($eyebrow)
                                <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;color:#8DC3C9;">{{ $eyebrow }}</p>
                            @endif
                            <h1 style="margin:0;font-size:27px;line-height:1.2;font-weight:700;color:#ffffff;">{!! $heading !!}</h1>
                            @if ($subheading)
                                <p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:#D2D8DD;">{{ $subheading }}</p>
                            @endif
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
                            {{ $slot }}
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:22px 32px 26px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #E4E8EB;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 10px;">
                                <tr>
                                    <td valign="middle" style="padding-right:9px;">
                                        {{-- Absolute URL, not cid: — most clients block images by
                                             default, so the alt text is the real fallback brand. --}}
                                        <img src="{{ rtrim((string) config('app.url'), '/') }}/carevance-logo-icon.png"
                                             width="26" height="26" alt="CareVance"
                                             style="display:block;width:26px;height:26px;border:0;">
                                    </td>
                                    <td valign="middle" style="font-size:13px;line-height:1.6;color:#4E565D;">
                                        {!! $footerLead !!}
                                    </td>
                                </tr>
                            </table>
                            @if ($footerNote)
                                <p style="margin:0;font-size:12px;line-height:1.7;color:#9AA4AC;">{{ $footerNote }}</p>
                            @endif
                        </td>
                    </tr>

                </table>

                <!--[if mso]>
                </td></tr></table>
                <![endif]-->

            </td>
        </tr>
    </table>

</body>
</html>
