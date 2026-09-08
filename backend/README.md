# TimeTrack Pro Backend

This folder contains the Laravel 12 API used by the React frontend and Electron desktop shell.

## Runtime

- PHP 8.2+
- Laravel 12
- Default database target: PostgreSQL
- Default queue connection: `database`
- Private file storage for screenshots and chat attachments

## Setup

```bash
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

If you want queued jobs processed in development, run:

```bash
php artisan queue:listen --tries=1 --timeout=0
```

## Important Environment Variables

```env
APP_URL=http://localhost:8000
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=timetrackpro
DB_USERNAME=postgres
DB_PASSWORD=your_password

QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
API_TOKEN_TTL_MINUTES=10080
SCREENSHOT_URL_TTL_MINUTES=30
IDLE_TRACK_THRESHOLD_SECONDS=180
IDLE_AUTO_STOP_THRESHOLD_SECONDS=900
DESKTOP_WINDOWS_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/latest/download/TimeTrack%20Pro-Setup-1.0.0-x64.exe
ATTENDANCE_LATE_AFTER=09:30:00
ATTENDANCE_SHIFT_SECONDS=28800
```

## Notes

- The API authenticates bearer tokens through `App\Http\Middleware\AuthenticateApiToken`.
- The codebase uses the `personal_access_tokens` table but does not rely on Sanctum middleware wiring.
- There is no separate broadcasting server configuration in this repo.
- Screenshots are exposed through short-lived signed URLs, and chat attachments stream through authenticated endpoints.
- Run `php artisan screenshots:health-check` and `php artisan idle:health-check` after deploys.

## Workspace Signup And SMTP Notes

- Public workspace-owner signup uses `POST /api/auth/signup-owner`.
- Secure onboarding invites use `POST /api/invitations`, `GET /api/invitations/{token}`, and `POST /api/invitations/{token}/accept`.
- Invitation emails are queue-ready Laravel mailables. Set `MAIL_MAILER=smtp`, configure the `MAIL_*` vars in `.env`, and keep a queue worker running if you are not using the `sync` driver.
- `FRONTEND_APP_URL` should point at the React app so invite emails generate `/accept-invite/:token` links correctly.

### Brevo SMTP Example

Use your Brevo SMTP credentials and keep secrets in `.env` only:

```env
MAIL_MAILER=smtp
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_USERNAME=your_brevo_login
MAIL_PASSWORD=your_brevo_smtp_key
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=your_sender_email
MAIL_FROM_NAME="CareVance HRMS"
```
