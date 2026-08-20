<?php

use Illuminate\Support\Facades\Route;

require base_path('routes/api/public.php');

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
    require base_path('routes/api/protected/invoices.php');
    require base_path('routes/api/protected/invitations.php');
    require base_path('routes/api/protected/notifications.php');
    require base_path('routes/api/protected/settings.php');
    require base_path('routes/api/protected/billing.php');
    require base_path('routes/api/protected/company.php');
    require base_path('routes/api/protected/audit.php');
    require base_path('routes/api/protected/projects.php');
    require base_path('routes/api/protected/tasks.php');
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
