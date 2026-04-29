# CareVance HRMS

CareVance HRMS is a workforce operations platform with a Laravel API, a React web app, an Electron desktop tracker, and a browser extension for exact browser activity capture.

It covers team onboarding, attendance, time tracking, screenshots, monitoring, chat, payroll, invoicing, and reporting in one repository.

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
- TypeScript
- Vite 7
- React Router 6
- TanStack React Query 5
- Tailwind CSS 3

### Desktop

- Electron 41
- Electron Builder
- Electron Updater
- Local browser-tracking bridge for the Chromium extension

## Core Features

- Owner signup and invitation-based employee onboarding
- Role-aware user management
- Attendance and manual time tracking
- Desktop timer, screenshots, and activity collection
- Exact browser activity tracking through the desktop bridge + extension
- Live monitoring dashboards
- Private chat and team communication
- Payroll, payslips, and Stripe-oriented payment flows
- Invoicing and operational reporting

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
VITE_SALES_EMAIL=sales@carevance.example
VITE_SUPPORT_EMAIL=support@carevance.example
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
