<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Payslip</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(15,23,42,0.1);">
                    <tr>
                        <td style="padding:28px 32px;background:#0f172a;color:#ffffff;">
                            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;color:#bae6fd;">CareVance HRMS</p>
                            <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:700;">Your Payslip is Ready</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:28px 32px;">
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Hi {{ $employee->first_name ?? $employee->name }},
                            </p>
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Your payslip for <strong>{{ $monthLabel }}</strong> has been generated and is attached to this email as a PDF.
                            </p>
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Please find the payslip PDF attached. You can also download it from the Employee Pay section of the HRMS portal.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px 28px;">
                            <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8;">
                                This is an automated email from CareVance HRMS. Please do not reply to this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
