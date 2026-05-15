# CareVance HRMS

CareVance HRMS is a comprehensive workforce operations platform built with a Laravel API, a React web app, an Electron desktop tracker, and a browser extension for exact browser activity capture.

It covers team onboarding, attendance, time tracking, screenshots, monitoring, chat, payroll, invoicing, approvals, and reporting in one repository.

## What Is In This Repo

- `backend/` Laravel 12 API and business logic
- `frontend/` React 18 + TypeScript web application
- `desktop/` Electron desktop tracker and browser-tracking bridge
- `browser-extension/` Chromium-based extension used by the desktop bridge
- `docs/` supporting product and operational documentation

## Tech Stack

### Backend

- PHP 8.2+
- Laravel 12
- PostgreSQL by default
- Database queue driver by default
- Token-based API auth with secure HTTP-only cookie support for the SPA
- Dompdf for PDF generation

### Frontend

- React 18
- TypeScript 5
- Vite 7
- React Router 6
- TanStack React Query 5
- Tailwind CSS 3
- Framer Motion 12
- Lucide React
- Vitest 4

### Desktop

- Electron 41
- Electron Builder
- Electron Updater
- Local browser-tracking bridge for the Chromium extension

## Core Features

### HRMS & Employee Management
- Owner signup and invitation-based employee onboarding
- Bulk employee import via Excel
- Role-aware user management (admin, manager, employee, client)
- Employee 360-degree profiles with work info, government IDs, bank accounts, and documents
- New hires and resignations tracking
- Departments, roles, and permissions management
- Announcements and notifications center

### Attendance & Leave
- Check-in/check-out with today status, calendar view, and summary reports
- Leave request lifecycle with approval workflow (approve/reject/revoke)
- Leave revocation workflow (request revoke, then approve/reject revocation)
- Leave balances and consumption tracking
- Attendance time edit requests (overtime corrections) with approval flow
- Holiday management (admin)
- Approval Inbox for centralized leave and time edit approvals with pending/history views
- Leave Intelligence analytics with trend charts, department breakdowns, and coverage pressure metrics

### Time Tracking & Monitoring
- Desktop timer with auto-start capability and dedicated timer dashboard
- Screenshots with bulk management, single detail view, and signed URL access
- Activity and session tracking with store/update endpoints
- Exact browser activity tracking through the desktop bridge + extension
- Browser tracking connection sync and health monitoring
- Productivity rules engine (classify apps, domains, URLs, titles as productive/unproductive/neutral with regex, contains, starts_with, ends_with match modes)
- Productivity rule testing endpoint before saving
- Live monitoring dashboards (productive time, unproductive time, screenshots, app usage, website usage)
- Web and app usage reports
- Timeline reports for employee work patterns
- Custom report groups for filtering

### Communication
- Private direct messaging with full CRUD, edit, and delete
- Group chats with create, send, update, delete, reactions, and typing indicators
- File attachments in chat with download support
- Unread message summary and tracking
- Available users listing for chat initiation
- Mark conversations and groups as read

### Payroll
- Salary profiles and templates
- Payroll run generation with multi-stage approval workflow
- Payslip generation and PDF download
- Payroll adjustments and tax declarations
- Reimbursement claims
- Compliance tracking and readiness warnings
- Payroll reports and analytics

### Projects & Tasks
- Project creation and management
- Task assignment with status tracking
- Time entries linked to projects and tasks
- Project-specific reports and stats

### Reports & Analytics
- Dashboard stats and KPIs
- Timesheets view (hours tracked)
- Daily, weekly, and monthly reports
- Productivity reports
- Attendance reports
- Team and employee insights
- Overall organizational reports
- Project-specific reports
- Projects and tasks report
- Custom export functionality
- Analytics hub with visualizations
- Timeline reports for activity patterns

### Financial
- Invoice creation and management
- Stripe-oriented payment flows
- Billing and subscription management (trial/paid, monthly/yearly)

### Administration
- Super admin multi-tenant company management with company detail views
- Audit logs for system-wide activity tracking
- Organization settings and configuration with member management
- Bug report system with categorized submissions (bug, UI, performance, billing, account, other)
- Integrations settings page
- Custom fields settings page
- Billing settings and subscription management
- Role-based route guards (Protected, Public, Admin, StrictAdmin, SuperAdmin)
- Per-endpoint rate limiting (auth, screenshots, chat, invitations, notifications, settings)
- Chunk recovery mechanism for failed dynamic imports
- Stripe payment return flow handling

## Architecture

This is a modular monorepo.

- The `backend` folder is the system of record and exposes the API used by the web app and desktop app.
- The `frontend` folder is the main HRMS client.
- The `desktop` folder wraps the web experience with tracker capabilities and a localhost browser-tracking service.
- The `browser-extension` folder contains the extension assets that pair with the desktop bridge.

## Quick Start

### 1. Backend

```bash
cd backend
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

Run the queue worker in a second terminal:

```bash
cd backend
php artisan queue:listen --tries=1 --timeout=0
```

Useful backend defaults:

```env
APP_URL=http://localhost:8000
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=carevance
DB_USERNAME=postgres
DB_PASSWORD=your_password
QUEUE_CONNECTION=database
SESSION_DRIVER=database
CACHE_STORE=database
```

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Recommended local frontend env:

```env
VITE_API_URL=http://localhost:8000/api
VITE_WEB_APP_URL=http://localhost:5173
VITE_DESKTOP_DOWNLOAD_LABEL=Download for Windows
VITE_SALES_EMAIL=aayushborwal.carevanceglobal@gmail.com
VITE_SUPPORT_EMAIL=mavliribaz.carevanceglobal@gmail.com
```

### 3. Desktop Tracker

```bash
cd desktop
npm install
npm start
```

The desktop shell opens the URL provided by `APP_URL`.

Allowed values are intentionally restricted:

- `https://...` for deployed environments
- `http://localhost...` for local development
- `http://127.0.0.1...` for local development

Example:

```powershell
$env:APP_URL="http://localhost:5173"
npm start
```

## Browser Tracking

The browser tracking flow uses the desktop app plus the extension together.

- The desktop app exposes a localhost bridge
- The browser extension pairs to that bridge with a short-lived pairing code
- Trusted extension origins are allowlisted in desktop app config
- Chrome and Edge origins can both be configured

Important:

- do not trust wildcard extension origins
- keep the desktop app and extension on matching versions
- use the generated app config for Chrome and Edge origin allowlisting

## Common Commands

### Backend

```bash
cd backend
php artisan test
composer test:coverage
composer route:test-matrix
```

### Frontend

```bash
cd frontend
npm test
npm run build
npm run test:coverage
```

### Desktop

```bash
cd desktop
npm start
npm run dist:win
npm run dist:portable
```

## API Overview

The API is organized into these route groups:

| Group | Base Path | Description |
|-------|-----------|-------------|
| Health | `/api/health` | Health check endpoints (`/health`, `/health/simple`) |
| Auth | `/api/auth` | Login, logout, registration, password reset, email verification, `/me`, `/handoff` |
| Users | `/api/users` | User CRUD, employee profiles, groups, teams, `/stats`, `/profile-360` |
| Employees | `/api/employees` | Employee workspace, profile, work info, government IDs, bank accounts, documents |
| Attendance | `/api/attendance` | Check-in/out, today status, calendar, summary, holidays |
| Leave | `/api/leave-requests` | Leave CRUD, balances, approve/reject, revoke request/approve/reject |
| Time Edits | `/api/attendance-time-edit-requests` | Overtime/time edit requests with approval flow |
| Monitoring | `/api/monitoring` | Screenshots (CRUD, bulk delete, signed file access), activities |
| Activity Sessions | `/api/activity-sessions` | Activity session store and update |
| Browser Tracking | `/api/browser-tracking` | Browser tracking connection sync and health |
| Payroll | `/api/payroll` | Payslips (PDF download), payroll runs, salary profiles, adjustments, settings, mark paid |
| Reports | `/api/reports` | Daily/weekly/monthly, productivity, attendance, team, employee insights, overall, project, exports |
| Dashboard | `/api/dashboard` | Dashboard stats and KPIs |
| Chat | `/api/chat` | Direct messages, group chats, reactions, typing, attachments, unread summary, available users |
| Projects | `/api/projects` | Project CRUD, tasks, time entries, stats |
| Tasks | `/api/tasks` | Task CRUD, status updates, time entries |
| Time Entries | `/api/time-entries` | Time entry CRUD, start/stop timer, active, today |
| Invoices | `/api/invoices` | Invoice CRUD, send, mark paid |
| Notifications | `/api/notifications` | Notifications, announcements, mark read/all read, publish |
| Settings | `/api/settings` | Profile, password, preferences, organization, productivity rules (CRUD + test), billing |
| Billing | `/api/billing` | Current billing snapshot and subscription info |
| Audit | `/api/audit` | Audit logs (admin/manager) |
| Invitations | `/api/invitations` | Invitation management, bulk import from Excel |
| Invites | `/api/invites` | Send invite, validate invite, accept invite |
| Organizations | `/api/organizations` | Organization CRUD, member listing, invite-to-org |
| Company | `/api/me/company` | Current company info |
| Support | `/api/support` | Bug report submission |
| Downloads | `/api/downloads` | Desktop app download (Windows) |
| Media | `/api/media` | Public media file serving |
| Groups | `/api/groups` | Custom report group CRUD |

## Frontend Routes

Key pages and routes in the web application:

| Route | Page | Access |
|-------|------|--------|
| `/` | Landing page | Public |
| `/login` | Login | Public |
| `/register`, `/signup`, `/start-trial` | Owner signup | Public |
| `/forgot-password`, `/reset-password`, `/verify-email` | Password recovery | Public |
| `/accept-invite/:token` | Accept invitation | Public |
| `/pricing`, `/contact-sales`, `/support`, `/terms`, `/privacy` | Info pages | Public |
| `/dashboard` | Main dashboard | Protected |
| `/time-tracker` | Desktop timer dashboard | Protected (desktop context) |
| `/employees` | Employee management | Admin |
| `/employees/:employeeId` | Employee detail workspace | Admin |
| `/employees/teams`, `/employees/invitations`, `/employees/roles` | Employee sub-pages | Admin |
| `/new-hires`, `/resignations` | Onboarding/offboarding | Admin |
| `/add-user` | Add user page | Strict Admin |
| `/attendance` | Attendance view | Protected |
| `/leave` | Leave requests | Protected |
| `/edit-time` | Time edit requests | Protected |
| `/approval-inbox` | Approval inbox (leave + time edit) | Admin/Manager |
| `/monitoring/productive-time` | Productive time monitoring | Admin/Manager |
| `/monitoring/unproductive-time` | Unproductive time monitoring | Admin/Manager |
| `/monitoring/screenshots` | Screenshot gallery | Admin/Manager |
| `/monitoring/app-usage` | App usage report | Admin/Manager |
| `/monitoring/website-usage` | Website usage report | Admin/Manager |
| `/reports/hours-tracked` | Timesheets | Protected |
| `/reports/projects-tasks` | Projects and tasks report | Protected |
| `/reports/productivity` | Productivity report | Protected |
| `/reports/custom-export` | Custom export | Protected |
| `/reports/attendance` | Attendance report | Protected |
| `/reports/timeline` | Timeline report | Protected |
| `/analytics` | Analytics hub | Protected |
| `/projects`, `/tasks` | Projects and tasks | Protected |
| `/chat` | Chat | Protected |
| `/notifications` | Notifications center | Protected |
| `/payroll` | Payroll workspace | Admin |
| `/payroll/employees/:employeeId` | Employee payroll detail | Admin |
| `/invoices` | Invoices | Admin/Manager |
| `/settings` | Settings (profile, org, notifications, security, help) | Protected |
| `/settings/integrations` | Integrations settings | Admin |
| `/settings/custom-fields` | Custom fields settings | Admin |
| `/settings/billing` | Billing settings | Admin |
| `/audit-logs` | Audit logs | Admin/Manager |
| `/super-admin/companies` | Company management | Super Admin |
| `/super-admin/companies/:companyId` | Company detail | Super Admin |

Route guards: `ProtectedRoute`, `PublicRoute`, `AdminRoute`, `StrictAdminRoute`, `SuperAdminRoute`

## Deployment Notes

- Set real secrets through environment variables, not committed files
- Keep `APP_DEBUG=false` outside local development
- Use HTTPS in deployed frontend and desktop `APP_URL` targets
- Run the backend queue worker in production
- Keep browser-tracking extension origins explicitly allowlisted
- Store employee documents on private storage only

## Security Notes

Recent hardening in this repository includes:

- secure handling of backend secrets and safer env defaults
- removal of TLS verification bypasses for Stripe requests
- stricter Electron sandboxing and remote URL validation
- allowlisted external URL opening from the desktop app
- encrypted persistence for desktop browser-tracking state
- reduced browser token persistence in the extension
- removal of SPA token storage from browser local/session storage
- private storage for employee documents

## Repository Status

Current package baselines in this repo:

- Laravel `^12.0`
- React `^18.2.0`
- Vite `^7.3.2`
- Electron `^41.3.0`

## License

Commercial - all rights reserved.
