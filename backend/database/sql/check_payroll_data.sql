-- FIX PAYROLL EMPLOYEES QUERY
-- Run this SQL to fix the department employees issue

-- First, let's see what we have
SELECT 'Total Users' as check_type, COUNT(*) as count FROM users WHERE organization_id = 1 AND role IN ('employee', 'manager', 'admin')
UNION ALL
SELECT 'Total Departments', COUNT(*) FROM groups WHERE organization_id = 1 AND is_active = 1
UNION ALL
SELECT 'Total Assignments', COUNT(*) FROM group_user gu JOIN groups g ON gu.group_id = g.id WHERE g.organization_id = 1;

-- Show all departments
SELECT id, name, code FROM groups WHERE organization_id = 1 AND is_active = 1;

-- Show all users
SELECT id, name, email, role FROM users WHERE organization_id = 1 AND role IN ('employee', 'manager', 'admin');

-- Show assignments
SELECT gu.group_id, g.name as department, gu.user_id, u.name as employee
FROM group_user gu
JOIN groups g ON gu.group_id = g.id
JOIN users u ON gu.user_id = u.id
WHERE g.organization_id = 1;
