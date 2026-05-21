# CareVance HRMS

**CareVance HRMS** is a comprehensive workforce operations platform built for modern organizations. It combines time tracking, attendance monitoring, payroll management, team communication, and productivity analytics into a single unified system.

The platform consists of four integrated components:
- **Laravel API** - Backend system of record
- **React Web App** - Full-featured HRMS client
- **Electron Desktop Tracker** - Time tracking with idle detection and auto-start
- **Browser Extension** - Exact browser activity capture

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Core Features](#core-features)
- [Quick Start](#quick-start)
- [Desktop Tracker](#desktop-tracker)
- [Browser Tracking](#browser-tracking)
- [API Overview](#api-overview)
- [Frontend Routes](#frontend-routes)
- [Common Commands](#common-commands)
- [Deployment](#deployment)
- [Security](#security)
- [License](#license)

---

## Architecture

CareVance is structured as a modular monorepo with four interconnected components:

```
CareVance/
── backend/              # Laravel 12 API (system of record)
├── frontend/             # React 18 + TypeScript web application
├── desktop/              # Electron desktop tracker + browser bridge
├── browser-extension/    # Chromium extension for browser activity
└── docs/                 # Product and operational documentation
```

**Data Flow:**
1. Desktop tracker captures activity → sends to Laravel API
2. Browser extension pairs with desktop bridge → forwards browser activity
3. React web app consumes API → renders dashboards, reports, and management UI
4. All components share the same PostgreSQL database through the API

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| PHP | 8.2+ | Runtime |
| Laravel | 12 | Framework |
| PostgreSQL | 15+ | Database |
| Laravel Queue | database | Job processing |
| Dompdf | latest | PDF generation |
| Auth | Token-based + HTTP-only cookies | Authentication |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18 | UI library |
| TypeScript | 5 | Type safety |
| Vite | 7 | Build tool |
| React Router | 6 | Routing |
| TanStack React Query | 5 | Data fetching |
| Tailwind CSS | 3 | Styling |
| Framer Motion | 12 | Animations |
| Lucide React | latest | Icons |
| Vitest | 4 | Testing |

### Desktop
| Technology | Version | Purpose |
|------------|---------|---------|
| Electron | 41 | Desktop shell |
| Electron Builder | latest | Packaging |
| Electron Updater | latest | Auto-updates |
| powerMonitor | Electron API | Idle/lock detection |

---

## Core Features

### HRMS & Employee Management
- Owner signup with invitation-based employee onboarding
- Bulk employee import via Excel
- Role-based access (super admin, admin, manager, employee, client)
- Employee 360° profiles (work info, government IDs, bank accounts, documents)
- New hires and resignations tracking
- Departments, roles, and permissions management
- Announcements and notifications center with desktop push notifications

### Attendance & Leave
- Check-in/check-out with today status, calendar view, and summary reports
- Leave request lifecycle with multi-level approval workflow
- Leave revocation workflow (request → approve/reject)
- Leave balances and consumption tracking
- Attendance time edit requests (overtime corrections) with approval flow
- Holiday management
- Approval Inbox with pending/history views
- Leave Intelligence analytics (trend charts, department breakdowns, coverage pressure)

### Time Tracking & Monitoring
- Desktop timer with **auto-start at office hours** and **OS boot auto-launch**
- **Idle time detection** with configurable thresholds (3 min track, 5 min auto-stop)
- **Lockscreen detection** - tracks idle during lock, auto-stops after threshold
- Screenshots with bulk management, detail view, and signed URL access
- Activity and session tracking with desktop/browser separation
- **Exact browser activity tracking** through desktop bridge + extension
- Productivity rules engine (classify apps/domains/URLs with regex matching)
- Live monitoring dashboards (productive time, unproductive time, screenshots)
- Web and app usage reports
- Timeline reports for employee work patterns
- Custom report groups for filtering

### Communication
- Private direct messaging with full CRUD, edit, and delete
- Group chats with create, send, reactions, and typing indicators
- File attachments with download support
- Unread message summary and tracking
- **Desktop notifications** for new messages with sound
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
- Custom export functionality
- Analytics hub with visualizations
- Timeline reports for activity patterns

### Financial
- Invoice creation and management
- Stripe-oriented payment flows
- Billing and subscription management (trial/paid, monthly/yearly)

### Administration
- Super admin multi-tenant company management
- Audit logs for system-wide activity tracking
- Organization settings with member management
- Bug report system with categorized submissions
- Integrations and custom fields settings
- Billing settings and subscription management
- Role-based route guards (Protected, Public, Admin, StrictAdmin, SuperAdmin)
- Per-endpoint rate limiting
- Chunk recovery mechanism for failed dynamic imports

---

## Quick Start

### Prerequisites
- PHP 8.2+ with Composer
- Node.js 18+ with npm
- PostgreSQL 15+
- Git

### 1. Backend

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

Run the queue worker in a second terminal:
```bash
cd backend
php artisan queue:listen --tries=1 --timeout=0
```

**Environment Configuration:**
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
cp .env.example .env
npm run dev
```

**Environment Configuration:**
```env
VITE_API_URL=http://localhost:8000/api
VITE_WEB_APP_URL=http://localhost:5173
VITE_DESKTOP_DOWNLOAD_LABEL=Download for Windows
VITE_SALES_EMAIL=sales@carevance.com
VITE_SUPPORT_EMAIL=support@carevance.com
```

### 3. Desktop Tracker

```bash
cd desktop
npm install
npm start
```

The desktop shell opens the URL from `APP_URL`. Allowed values:
- `https://...` for deployed environments
- `http://localhost...` for local development
- `http://127.0.0.1...` for local development

```powershell
$env:APP_URL="http://localhost:5173"
npm start
```

---

## Desktop Tracker

The CareVance Desktop Tracker runs in the system tray and provides:

### Auto-Start Behavior
- **OS Boot Launch** - Automatically starts when Windows boots (Registry + Task Scheduler + Startup folder)
- **Timer Auto-Start** - Automatically starts timer at configured office hours
- **Hidden on Launch** - Starts minimized to system tray, visible when user is ready

### Idle Detection
| Threshold | Default | Behavior |
|-----------|---------|----------|
| Idle Track | 3 minutes | Records idle activity after 3 min of inactivity |
| Idle Auto-Stop | 5 minutes | Stops timer and sends email notification after 5 min |
| Lockscreen | Immediate | Tracks as idle immediately, stops after 5 min |

### System Tray
- Double-click tray icon to open app window
- Right-click for menu (Open / Exit)
- Window close minimizes to tray (doesn't quit)

### Notifications
- Desktop push notifications for chat messages
- Desktop popup for idle auto-stop events
- Sound alerts for different notification types

---

## Browser Tracking

The browser tracking flow uses the desktop app plus the extension together:

1. Desktop app exposes a localhost bridge service
2. Browser extension pairs to the bridge with a short-lived pairing code
3. Extension forwards browser activity to the bridge
4. Bridge syncs activity to the Laravel API

**Configuration:**
- Trusted extension origins are allowlisted in desktop app config
- Chrome and Edge origins can both be configured
- Extension origins must be explicitly allowlisted (no wildcards)

**Important:**
- Keep desktop app and extension on matching versions
- Use the generated app config for Chrome/Edge origin allowlisting
- Do not trust wildcard extension origins

---

## Common Commands

### Backend
```bash
cd backend
php artisan test                    # Run tests
composer test:coverage              # Test with coverage
composer route:test-matrix          # Route matrix test
php artisan idle:health-check       # Validate idle pipeline config
```

### Frontend
```bash
cd frontend
npm test                            # Run tests
npm run build                       # Production build
npm run test:coverage               # Test with coverage
npx tsc --noEmit                    # Type check
```

### Desktop
```bash
cd desktop
npm start                           # Development mode
npm run dist:win                    # Build Windows installer
npm run dist:portable               # Build portable version
```

---

## API Overview

| Group | Base Path | Description |
|-------|-----------|-------------|
| Health | `/api/health` | Health check endpoints |
| Auth | `/api/auth` | Login, logout, registration, password reset, `/me` |
| Users | `/api/users` | User CRUD, employee profiles, groups, teams |
| Employees | `/api/employees` | Employee workspace, profiles, documents |
| Attendance | `/api/attendance` | Check-in/out, today status, calendar, holidays |
| Leave | `/api/leave-requests` | Leave CRUD, balances, approve/reject, revoke |
| Time Edits | `/api/attendance-time-edit-requests` | Overtime requests with approval |
| Monitoring | `/api/monitoring` | Screenshots, activities, productivity |
| Activity Sessions | `/api/activity-sessions` | Session store and update |
| Browser Tracking | `/api/browser-tracking` | Connection sync and health |
| Payroll | `/api/payroll` | Payslips, runs, profiles, adjustments |
| Reports | `/api/reports` | Daily/weekly/monthly, productivity, attendance |
| Dashboard | `/api/dashboard` | Stats and KPIs |
| Chat | `/api/chat` | Direct messages, groups, reactions, typing |
| Projects | `/api/projects` | Project CRUD, tasks, time entries |
| Tasks | `/api/tasks` | Task CRUD, status updates |
| Time Entries | `/api/time-entries` | Timer start/stop, active entries |
| Invoices | `/api/invoices` | Invoice CRUD, send, mark paid |
| Notifications | `/api/notifications` | Notifications, announcements, publish |
| Settings | `/api/settings` | Profile, org, productivity rules |
| Billing | `/api/billing` | Subscription info |
| Audit | `/api/audit` | Audit logs |
| Invitations | `/api/invitations` | Bulk import from Excel |
| Invites | `/api/invites` | Send, validate, accept invites |
| Organizations | `/api/organizations` | Org CRUD, member listing |
| Support | `/api/support` | Bug report submission |
| Downloads | `/api/downloads` | Desktop app download |

---

## Frontend Routes

| Route | Page | Access |
|-------|------|--------|
| `/` | Landing page | Public |
| `/login` | Login | Public |
| `/register`, `/signup`, `/start-trial` | Owner signup | Public |
| `/dashboard` | Main dashboard | Protected |
| `/time-tracker` | Desktop timer dashboard | Protected |
| `/employees` | Employee management | Admin |
| `/attendance` | Attendance view | Protected |
| `/leave` | Leave requests | Protected |
| `/edit-time` | Time edit requests | Protected |
| `/approval-inbox` | Approval inbox | Admin/Manager |
| `/monitoring/productive-time` | Productive time monitoring | Admin/Manager |
| `/monitoring/screenshots` | Screenshot gallery | Admin/Manager |
| `/monitoring/app-usage` | App usage report | Admin/Manager |
| `/monitoring/website-usage` | Website usage report | Admin/Manager |
| `/reports/hours-tracked` | Timesheets | Protected |
| `/reports/productivity` | Productivity report | Protected |
| `/reports/attendance` | Attendance report | Protected |
| `/reports/timeline` | Timeline report | Protected |
| `/analytics` | Analytics hub | Protected |
| `/projects`, `/tasks` | Projects and tasks | Protected |
| `/chat` | Chat | Protected |
| `/notifications` | Notifications center | Protected |
| `/payroll` | Payroll workspace | Admin |
| `/invoices` | Invoices | Admin/Manager |
| `/settings` | Settings | Protected |
| `/audit-logs` | Audit logs | Admin/Manager |
| `/super-admin/companies` | Company management | Super Admin |

**Route Guards:** `ProtectedRoute`, `PublicRoute`, `AdminRoute`, `StrictAdminRoute`, `SuperAdminRoute`

---

## Deployment

### Environment
- Set secrets through environment variables, never commit them
- Keep `APP_DEBUG=false` in production
- Use HTTPS for deployed frontend and desktop `APP_URL` targets
- Run the backend queue worker in production
- Store employee documents on private storage only

### Desktop Distribution
- Build Windows installer: `npm run dist:win`
- Build portable version: `npm run dist:portable`
- Desktop auto-updates via Electron Updater
- Auto-start configured via Registry + Task Scheduler + Startup folder

### Browser Extension
- Keep extension origins explicitly allowlisted
- Match desktop app and extension versions
- Use generated app config for Chrome/Edge allowlisting

---

## Security

Recent hardening includes:

- Secure handling of backend secrets and safer env defaults
- Removal of TLS verification bypasses for Stripe requests
- Stricter Electron sandboxing and remote URL validation
- Allowlisted external URL opening from desktop app
- Encrypted persistence for desktop browser-tracking state
- Reduced browser token persistence in extension
- Removal of SPA token storage from browser local/session storage
- Private storage for employee documents
- Per-endpoint rate limiting (auth, screenshots, chat, invitations)

---

## Repository Status

| Component | Version |
|-----------|---------|
| Laravel | ^12.0 |
| PHP | 8.2+ |
| React | ^18.2.0 |
| TypeScript | 5 |
| Vite | ^7.3.2 |
| Electron | ^41.3.0 |
| PostgreSQL | 15+ |

---

## License

**Commercial** - All rights reserved.
