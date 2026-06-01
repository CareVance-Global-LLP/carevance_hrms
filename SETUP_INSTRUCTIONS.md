# CareVance HRMS - Step-by-Step Setup Guide

## Table of Contents
1. [Prerequisites Overview](#1-prerequisites-overview)
2. [Install Required Software](#2-install-required-software)
3. [Database Setup](#3-database-setup)
4. [Backend Setup](#4-backend-setup)
5. [Frontend Setup](#5-frontend-setup)
6. [Desktop Tracker Setup](#6-desktop-tracker-setup-optional)
7. [Browser Extension Setup](#7-browser-extension-setup-optional)
8. [Running the Application](#8-running-the-application)
9. [Troubleshooting](#9-troubleshooting)
10. [Quick Reference](#10-quick-reference)

---

## 1. Prerequisites Overview

### System Requirements
- **Operating System:** Windows 10/11, macOS, or Linux
- **RAM:** 8GB minimum (16GB recommended)
- **Storage:** 20GB free disk space
- **Internet:** Stable connection for downloading packages

### Required Software Versions
| Software | Minimum Version | Download Link |
|----------|----------------|---------------|
| PHP | 8.2+ | https://windows.php.net/download/ |
| Composer | Latest | https://getcomposer.org/download/ |
| Node.js | 18+ | https://nodejs.org/ |
| PostgreSQL | 15+ | https://www.postgresql.org/download/ |
| Git | Latest | https://git-scm.com/download/ |

---

## 2. Install Required Software

### Step 2.1: Install PHP 8.2+ (Windows)

1. **Download PHP:**
   - Go to: https://windows.php.net/download/
   - Download: "VS16 x64 Non Thread Safe" ZIP file
   - Save to your Downloads folder

2. **Extract PHP:**
   ```
   - Extract the ZIP file to C:\php
   - You should see C:\php\php.exe
   ```

3. **Configure PHP:**
   ```
   - Copy C:\php\php.ini-development
   - Rename to C:\php\php.ini
   ```

4. **Enable Required Extensions:**
   - Open C:\php\php.ini in Notepad
   - Find and remove the semicolon (;) at the start of these lines:
   ```ini
   extension=pdo_pgsql
   extension=pgsql
   extension=openssl
   extension=curl
   extension=mbstring
   extension=xml
   extension=fileinfo
   extension=zip
   ```

5. **Add PHP to PATH:**
   ```
   - Press Windows Key + X
   - Click "System"
   - Click "Advanced system settings"
   - Click "Environment Variables"
   - Under "System variables", find "Path"
   - Click "Edit" → "New"
   - Type: C:\php
   - Click OK (3 times)
   ```

6. **Verify Installation:**
   ```cmd
   php -v
   ```
   Should show: PHP 8.2.x or higher

---

### Step 2.2: Install Composer (Windows)

1. **Download Composer:**
   - Go to: https://getcomposer.org/download/
   - Download: Composer-Setup.exe

2. **Run Installer:**
   ```
   - Double-click Composer-Setup.exe
   - Click "Next" → "Next"
   - Select your PHP (C:\php\php.exe)
   - Click "Next" → "Install" → "Finish"
   ```

3. **Verify Installation:**
   ```cmd
   composer -v
   ```
   Should show: Composer version x.x.x

---

### Step 2.3: Install Node.js 18+ (Windows)

1. **Download Node.js:**
   - Go to: https://nodejs.org/
   - Download LTS (Long Term Support) version

2. **Run Installer:**
   ```
   - Double-click the downloaded .msi file
   - Click "Next" → Accept License → "Next"
   - Keep default settings
   - Click "Install" → "Finish"
   ```

3. **Verify Installation:**
   ```cmd
   node -v
   npm -v
   ```
   Should show versions for both

---

### Step 2.4: Install PostgreSQL 15+ (Windows)

1. **Download PostgreSQL:**
   - Go to: https://www.postgresql.org/download/windows/
   - Click "Download the installer"
   - Select version 15.x or 16.x
   - Download for Windows x86-64

2. **Run Installer:**
   ```
   - Double-click the installer
   - Click "Next"
   - Installation Directory: Keep default
   - Components: Keep all selected (PostgreSQL Server, pgAdmin, Stack Builder)
   - Data Directory: Keep default
   - Password: Enter a strong password (REMEMBER THIS!)
   - Port: Keep default (5432)
   - Locale: Keep default
   - Click "Next" → "Next" → "Next"
   - Wait for installation
   - Click "Finish"
   ```

3. **Add to PATH:**
   ```
   - Press Windows Key + X → System → Advanced system settings
   - Environment Variables → System variables → Path → Edit
   - Click "New" → Add: C:\Program Files\PostgreSQL\15\bin
   - Click OK (3 times)
   ```

4. **Verify Installation:**
   ```cmd
   psql --version
   ```
   Should show: psql (PostgreSQL) 15.x or 16.x

---

### Step 2.5: Install Git (Windows)

1. **Download Git:**
   - Go to: https://git-scm.com/download/win
   - Download will start automatically

2. **Run Installer:**
   ```
   - Double-click the installer
   - Click "Next" through all steps
   - Use default options
   - Click "Install" → "Finish"
   ```

3. **Verify Installation:**
   ```cmd
   git --version
   ```
   Should show: git version 2.x.x

---

## 3. Database Setup

### Step 3.1: Start PostgreSQL

1. **Check if PostgreSQL is running:**
   ```
   - Press Windows Key + R
   - Type: services.msc
   - Press Enter
   - Look for "postgresql-x64-15" or similar
   - Status should be "Running"
   - If not, right-click → Start
   ```

### Step 3.2: Create Database

1. **Open Command Prompt:**
   ```cmd
   psql -U postgres
   ```

2. **Enter your PostgreSQL password** (set during installation)

3. **Create the database:**
   ```sql
   CREATE DATABASE carevance;
   ```

4. **Verify database was created:**
   ```sql
   \l
   ```
   You should see "carevance" in the list

5. **Exit PostgreSQL:**
   ```sql
   \q
   ```

---

## 4. Backend Setup

### Step 4.1: Clone or Navigate to Project

```cmd
cd D:\CareVance_Hrms_IDE
```

### Step 4.2: Install PHP Dependencies

```cmd
cd backend
composer install
```
⏱️ This will take 2-5 minutes. Wait for it to complete.

### Step 4.3: Setup Environment File

```cmd
copy .env.example .env
```

### Step 4.4: Configure Backend Environment

1. **Open the .env file:**
   ```cmd
   notepad .env
   ```

2. **Update these settings** (find and replace):
   ```env
   APP_NAME=CareVance
   APP_ENV=local
   APP_DEBUG=true
   APP_URL=http://localhost:8000
   FRONTEND_APP_URL=http://localhost:5173
   
   DB_CONNECTION=pgsql
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_DATABASE=carevance
   DB_USERNAME=postgres
   DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE
   
   CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
   
   QUEUE_CONNECTION=database
   CACHE_STORE=database
   SESSION_DRIVER=database
   ```

3. **Save and close Notepad**

### Step 4.5: Generate Application Key

```cmd
php artisan key:generate
```
Should show: "Application key set successfully."

### Step 4.6: Run Database Migrations

```cmd
php artisan migrate
```
⏱️ This will create all database tables.

Type "yes" when asked to confirm.

### Step 4.7: Install Laravel Frontend Assets

```cmd
npm install
```
⏱️ Wait for completion.

```cmd
npm run build
```
⏱️ Wait for build to complete.

---

## 5. Frontend Setup

### Step 5.1: Navigate to Frontend

```cmd
cd ..\frontend
```

### Step 5.2: Install Dependencies

```cmd
npm install
```
⏱️ This will take 3-5 minutes.

### Step 5.3: Setup Environment File

```cmd
copy .env.example .env
```

### Step 5.4: Configure Frontend Environment

1. **Open the .env file:**
   ```cmd
   notepad .env
   ```

2. **Ensure these settings exist:**
   ```env
   VITE_API_URL=http://localhost:8000/api
   VITE_WEB_APP_URL=http://localhost:5173
   VITE_DESKTOP_DOWNLOAD_LABEL=Download for Windows
   VITE_SALES_EMAIL=sales@carevance.com
   VITE_SUPPORT_EMAIL=support@carevance.com
   ```

3. **Save and close Notepad**

---

## 6. Desktop Tracker Setup (Optional)

### Step 6.1: Navigate to Desktop

```cmd
cd ..\desktop
```

### Step 6.2: Install Dependencies

```cmd
npm install
```
⏱️ Wait for completion.

### Step 6.3: Prepare App Configuration

```cmd
npm run prepare:app-config
npm run prepare:browser-extension
```

---

## 7. Browser Extension Setup (Optional)

### Step 7.1: Extension Files Location

```
D:\CareVance_Hrms_IDE\browser-extension\chromium
```

### Step 7.2: Load Extension in Chrome/Edge

1. **Open Chrome or Edge**
2. **Type in address bar:**
   ```
   chrome://extensions/
   ```
3. **Enable "Developer mode"** (toggle in top-right corner)
4. **Click "Load unpacked"**
5. **Navigate to:**
   ```
   D:\CareVance_Hrms_IDE\browser-extension\chromium
   ```
6. **Click "Select Folder"**
7. Extension should now appear in your extensions list

---

## 8. Running the Application

You need to open **3 separate command prompt windows** and run these commands:

### Window 1 - Backend API Server:

```cmd
cd D:\CareVance_Hrms_IDE\backend
php artisan serve
```
✅ Keep this window open! Server runs on http://localhost:8000

### Window 2 - Queue Worker (Required!):

```cmd
cd D:\CareVance_Hrms_IDE\backend
php artisan queue:listen --tries=1 --timeout=0
```
✅ Keep this window open! This processes background jobs.

### Window 3 - Frontend Development Server:

```cmd
cd D:\CareVance_Hrms_IDE\frontend
npm run dev
```
✅ Keep this window open! Server runs on http://localhost:5173

### Window 4 - Desktop Tracker (Optional):

```cmd
cd D:\CareVance_Hrms_IDE\desktop
set APP_URL=http://localhost:5173
npm start
```
✅ Desktop app will open. Keep this window open.

---

## 9. Access the Application

1. **Open your web browser**
2. **Go to:** http://localhost:5173
3. **You should see the CareVance landing page**
4. **Click "Get Started" or "Start Trial"**
5. **Create your Owner Account** (first super-admin user)
6. **Start using CareVance HRMS!**

---

## 9. Troubleshooting

### Problem: "php artisan migrate" fails

**Solution:**
```cmd
# Check PostgreSQL is running
psql -U postgres -c "\l"

# If error, verify credentials in .env file
# Then try again:
php artisan migrate
```

### Problem: "composer install" fails

**Solution:**
```cmd
# Clear composer cache
composer clear-cache

# Try again
composer install
```

### Problem: "npm install" fails

**Solution:**
```cmd
# Delete node_modules and reinstall
cd frontend
rmdir /s /q node_modules
del package-lock.json
npm install
```

### Problem: "php artisan serve" shows CORS errors

**Solution:**
```cmd
# Check CORS_ALLOWED_ORIGINS in backend/.env
# Must match your frontend URL exactly
# Then restart the server
```

### Problem: Queue jobs not processing

**Solution:**
```cmd
# Make sure queue worker is running in Window 2
# Check QUEUE_CONNECTION=database in .env
```

### Problem: Desktop app won't start

**Solution:**
```cmd
cd desktop
set APP_URL=http://localhost:5173
npm start
```

### Problem: Browser extension not pairing

**Solution:**
```
1. Ensure desktop app is running
2. Refresh the extension (chrome://extensions/ → click refresh icon)
3. Check desktop bridge is working
```

---

## 10. Quick Reference

### Useful Commands

**Backend:**
```cmd
cd D:\CareVance_Hrms_IDE\backend
php artisan serve                    # Start server
php artisan migrate                  # Run migrations
php artisan migrate:fresh --seed     # Reset database with test data
php artisan test                     # Run tests
php artisan cache:clear              # Clear cache
php artisan config:clear             # Clear config cache
```

**Frontend:**
```cmd
cd D:\CareVance_Hrms_IDE\frontend
npm run dev                          # Start dev server
npm run build                        # Build for production
npm test                             # Run tests
```

**Desktop:**
```cmd
cd D:\CareVance_Hrms_IDE\desktop
set APP_URL=http://localhost:5173
npm start                            # Start desktop app
npm run dist:win                     # Build Windows installer
```

### Service URLs

| Service | URL |
|---------|-----|
| Web App | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| PostgreSQL | localhost:5432 |

### File Locations

| Component | Path |
|-----------|------|
| Backend | D:\CareVance_Hrms_IDE\backend |
| Frontend | D:\CareVance_Hrms_IDE\frontend |
| Desktop | D:\CareVance_Hrms_IDE\desktop |
| Extension | D:\CareVance_Hrms_IDE\browser-extension\chromium |
| Logs | D:\CareVance_Hrms_IDE\backend\storage\logs\laravel.log |

---

## Setup Checklist

- [ ] PHP 8.2+ installed and in PATH
- [ ] Composer installed
- [ ] Node.js 18+ installed
- [ ] PostgreSQL 15+ installed and running
- [ ] Git installed
- [ ] Database "carevance" created
- [ ] Backend dependencies installed (composer install)
- [ ] Backend .env configured
- [ ] Database migrations completed
- [ ] Frontend dependencies installed (npm install)
- [ ] Frontend .env configured
- [ ] Backend server running (php artisan serve)
- [ ] Queue worker running (php artisan queue:listen)
- [ ] Frontend server running (npm run dev)
- [ ] Successfully accessed http://localhost:5173

**🎉 Congratulations! You're ready to use CareVance HRMS!**
