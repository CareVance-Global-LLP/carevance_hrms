<?php

use Illuminate\Support\Facades\Route;

require base_path('routes/api/public.php');

/*
 * Punch-device ingestion. Outside the api.token group because a wall terminal
 * cannot hold a token - see the file for what stands in for authentication.
 */
require base_path('routes/api/biometric.php');

/*
 * The customer-facing read API, authenticated by API key rather than by a
 * user session. Registered outside the api.token group on purpose — see the
 * file for why the two auth mechanisms stay separate.
 */
require base_path('routes/api/v1.php');

Route::middleware(['api.token', 'mfa.enrolled'])->group(function () {
    require base_path('routes/api/protected/auth.php');
    require base_path('routes/api/protected/users.php');
    require base_path('routes/api/protected/attendance.php');
    require base_path('routes/api/protected/monitoring.php');
    require base_path('routes/api/protected/reports.php');
    require base_path('routes/api/protected/chat.php');
    require base_path('routes/api/protected/uploads.php');
    require base_path('routes/api/protected/invoices.php');
    require base_path('routes/api/protected/invitations.php');
    require base_path('routes/api/protected/notifications.php');
    require base_path('routes/api/protected/settings.php');
    require base_path('routes/api/protected/billing.php');
    require base_path('routes/api/protected/company.php');
    require base_path('routes/api/protected/audit.php');
    require base_path('routes/api/protected/projects.php');
    require base_path('routes/api/protected/tasks.php');
    require base_path('routes/api/protected/biometric_devices.php');
    require base_path('routes/api/protected/leave_types.php');
    require base_path('routes/api/protected/saml_connections.php');
    require base_path('routes/api/protected/statutory_compliance.php');
    require base_path('routes/api/protected/recruitment.php');
    require base_path('routes/api/protected/roster.php');
    require base_path('routes/api/protected/accounting_export.php');
    require base_path('routes/api/protected/legal_entities.php');
    require base_path('routes/api/protected/organizations.php');
    require base_path('routes/api/protected/super-admin.php');
    require base_path('routes/api/protected/resignations.php');
    require base_path('routes/api/protected/lifecycle.php');
    require base_path('routes/api/protected/geofence.php');
    require base_path('routes/api/protected/team.php');
    require base_path('routes/api/protected/payroll.php');
    require base_path('routes/api/protected/performance.php');
    require base_path('routes/api/protected/payroll_filings.php');
    require base_path('routes/api/protected/compoff.php');
    require base_path('routes/api/protected/assets.php');
    require base_path('routes/api/protected/search.php');
    require base_path('routes/api/protected/security.php');
    require base_path('routes/api/protected/integrations.php');
    require base_path('routes/api/protected/working_time.php');
});
