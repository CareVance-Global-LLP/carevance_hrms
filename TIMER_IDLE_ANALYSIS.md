# Desktop Timer and Idle Logic Analysis

## Summary

**NO role-based differences found** in timer and idle logic between managers and employees. The timer and idle detection work identically for all roles.

## Timer Logic (Same for ALL Roles)

### 1. Starting Timer (`TimeEntryController::start()`)
- **Lines 209-269**: Timer start logic is identical for all roles
- When `timer_slot` is 'primary', it automatically creates attendance record via `ensureAttendanceCheckedIn()`
- No role checks in timer start logic

### 2. Stopping Timer (`TimeEntryController::stop()`)
- **Lines 271-351**: Timer stop logic is identical for all roles
- Supports `auto_stopped_for_idle` parameter for idle auto-stop
- No role checks in timer stop logic

### 3. Idle Auto-Stop Logic
- **Lines 304-348**: Idle validation and auto-stop
- Uses `buildIdleAutoStopContext()` to validate idle state
- Sends email notification when timer is auto-stopped for idle
- **NO role-based differences** - works the same for all users

## Idle Detection (Same for ALL Roles)

### Activity Tracking (`ActivityController`)
- **Lines 318-424**: Activity storage logic
- No role checks when storing activities
- All users' activities are tracked the same way

### Idle Calculation (`ActivityFeedService`)
- **Lines 18-107**: `forUsersInRangeForIdle()` method
- Fetches idle activities from database
- No role filtering - all users treated equally

### Idle Time Calculation (`ReportController`)
- **Lines 542-555**: `safeCalculateIdleTime()` method
- Calculates idle time from activities
- No role-based differences in calculation

## Key Differences Found (NOT Role-Based)

### 1. Project/Task Assignment Check
**TimeEntryController.php lines 607-612**:
```php
$assignedProjectIds = $user->getHierarchyLevel() >= 100
    ? $user->assignedProjects()->pluck('projects.id')->map(fn ($id) => (int) $id)->all()
    : [];
```
- **Employees (level >= 100)**: Must be assigned to projects
- **Managers (level < 100)**: Can access all projects (no restriction)

### 2. Task Status Update
**TimeEntryController.php lines 783-786**:
```php
if ($user->getHierarchyLevel() >= 100 && $task->status !== 'in_progress') {
    $task->update(['status' => 'in_progress']);
}
```
- **Employees**: Starting timer changes task status to 'in_progress'
- **Managers**: Task status unchanged when starting timer

### 3. Activity Viewing Permissions
**ActivityController.php lines 29-32**:
```php
private function canViewAll(?\App\Models\User $user): bool
{
    return $user && in_array($user->role, ['admin', 'manager'], true);
}
```
- **Managers**: Can view all users' activities
- **Employees**: Can only view their own activities

## Fixed Issue: Manager Self-Exclusion

### Problem
Managers were being excluded from their own dashboard statistics because `visibleUsersQuery()` with `$excludeHigherOrEqualRank = true` excluded users with hierarchy level >= current user's level.

### Solution
Added `->orWhere('id', $user->id)` to always include the current user:

**Files Fixed**:
1. `AttendanceService.php` - lines 43-52
2. `ReportController.php` - lines 194-203
3. `ScreenshotController.php` - lines 568-573

## Conclusion

The desktop timer and idle detection logic is **identical for all roles**. The only differences are:
1. **Project access** (managers have broader access)
2. **Task status updates** (only employees trigger status changes)
3. **Activity viewing** (managers can view all users' activities)

The "unusual" behavior you noticed was likely due to the manager self-exclusion bug that has now been fixed.
