# Test Users Setup

## Test User Credentials

The following test users have been added to the seeder:

### 1. Admin User (Already existed)
- **Name:** Ayush Borwal
- **Email:** ayushborwal004@gmail.com
- **Password:** 12345678
- **Role:** admin

### 2. Employee User (NEW)
- **Name:** test1
- **Email:** test1@test.com
- **Password:** 12345678
- **Role:** employee

### 3. Manager User (NEW)
- **Name:** test2
- **Email:** test2@test.com
- **Password:** 12345678
- **Role:** manager

## How to Create Test Users

### Option 1: Run the Seeder (Recommended)

```bash
cd backend
php artisan db:seed --class=CreateTestUserSeeder
```

This will create:
- Test Organization (if not exists)
- Admin user: ayushborwal004@gmail.com
- Employee user: test1@test.com
- Manager user: test2@test.com

### Option 2: Run All Seeders

```bash
cd backend
php artisan db:seed
```

### Option 3: Fresh Database with Seeders

```bash
cd backend
php artisan migrate:fresh --seed
```

## Notes

- All test users have the same password: `12345678`
- All users are automatically email-verified for testing
- All users belong to the same organization: "Test Organization"
- The employee and manager users will see the "Resignation" menu in the sidebar
- The admin user will NOT see the "Resignation" menu (they see "Resignations" under HRMS instead)

## Testing Resignation Feature

1. Login as **test1@test.com** (Employee) or **test2@test.com** (Manager)
2. You should see "Resignation" in the left sidebar navigation
3. Click on it to access the resignation submission page
4. Admins logging in with **ayushborwal004@gmail.com** will NOT see this menu (they manage resignations under HRMS > Resignations)
