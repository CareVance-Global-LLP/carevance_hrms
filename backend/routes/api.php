<?php

use Illuminate\Support\Facades\Route;

require base_path('routes/api/public.php');

Route::middleware('api.token')->group(function () {
    require base_path('routes/api/protected/auth.php');
    require base_path('routes/api/protected/users.php');
    require base_path('routes/api/protected/attendance.php');
    require base_path('routes/api/protected/monitoring.php');
    require base_path('routes/api/protected/reports.php');
    require base_path('routes/api/protected/chat.php');
    require base_path('routes/api/protected/invoices.php');
    require base_path('routes/api/protected/invitations.php');
    require base_path('routes/api/protected/invites.php');
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
    require base_path('routes/api/protected/geofence.php');
});
