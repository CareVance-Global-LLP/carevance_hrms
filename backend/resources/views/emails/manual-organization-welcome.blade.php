<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to CareVance</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(15,23,42,0.1);">
                    <tr>
                        <td style="padding:28px 32px;background:linear-gradient(135deg,#020617 0%,#0f172a 100%);color:#ffffff;">
                            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;color:#bae6fd;">CareVance HRMS</p>
                            <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:700;">Welcome to CareVance!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:28px 32px;">
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Hello {{ $userName }},
                            </p>
                            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Your CareVance workspace for <strong>{{ $organizationName }}</strong> has been created and is ready to use.
                            </p>
                            
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:#f1f5f9;border-radius:12px;padding:20px;">
                                <tr>
                                    <td style="padding:0 0 12px;border-bottom:1px solid #e2e8f0;">
                                        <p style="margin:0;font-size:13px;color:#64748b;">Plan</p>
                                        <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#0f172a;text-transform:capitalize;">{{ $planName }}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:12px 0;">
                                        <p style="margin:0;font-size:13px;color:#64748b;">Seats</p>
                                        <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#0f172a;">{{ $seats }} users</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:20px 0 12px;font-size:15px;line-height:1.7;color:#475569;">
                                <strong>Your login credentials:</strong>
                            </p>
                            
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
                                <tr>
                                    <td style="padding-bottom:8px;">
                                        <p style="margin:0;font-size:13px;color:#64748b;">Email</p>
                                        <p style="margin:4px 0 0;font-size:14px;font-weight:500;color:#0f172a;">{{ $userEmail }}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding-top:8px;border-top:1px dashed #cbd5e1;">
                                        <p style="margin:0;font-size:13px;color:#64748b;">Temporary Password</p>
                                        <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0f172a;font-family:monospace;background:#ffffff;padding:8px 12px;border-radius:6px;border:1px solid #e2e8f0;">{{ $tempPassword }}</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:20px 0 16px;font-size:15px;line-height:1.7;color:#475569;">
                                Click the button below to log in and start using your workspace:
                            </p>
                            
                            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0;">
                                <tr>
                                    <td>
                                        <a
                                            href="{{ $loginUrl }}"
                                            style="display:inline-block;padding:14px 28px;border-radius:999px;background:linear-gradient(135deg,#0284c7 0%,#0ea5e9 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;box-shadow:0 10px 25px -8px rgba(14,165,233,0.5);"
                                        >
                                            Login to Your Workspace
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <div style="margin:24px 0;padding:16px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;">
                                <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;">
                                    <strong>Important:</strong> Please change your password after your first login for security purposes. You can do this from your Profile Settings.
                                </p>
                            </div>

                            <p style="margin:18px 0 6px;font-size:13px;line-height:1.7;color:#64748b;">
                                If the button does not work, copy and paste this link into your browser:
                            </p>
                            <p style="margin:0;font-size:13px;line-height:1.7;word-break:break-all;">
                                <a href="{{ $loginUrl }}" style="color:#0284c7;text-decoration:none;">{{ $loginUrl }}</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                            <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8;">
                                Need help? Contact us at support@carevance.io
                            </p>
                            <p style="margin:8px 0 0;font-size:12px;line-height:1.7;color:#94a3b8;">
                                &copy; {{ date('Y') }} CareVance. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
