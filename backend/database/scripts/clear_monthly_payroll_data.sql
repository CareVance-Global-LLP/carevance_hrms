-- =============================================================================
-- CAREVANCE HRMS - CLEAR MONTHLY PAYROLL DATA
-- =============================================================================
-- This script deletes all monthly payroll run data while preserving:
-- - Employee payroll configurations (templates, profiles)
-- - Salary templates and components
-- - Department payroll settings
-- - Pay groups and assignments
--
-- WARNING: This will delete ALL monthly payroll data including:
-- - All payroll runs (draft, done, approved, etc.)
-- - All payroll items for all employees
-- - All payslips
-- - All payroll transactions
-- - All payroll adjustments
-- - All payroll audit logs
-- - All payroll filings
--
-- Use with caution! This action cannot be undone.
-- =============================================================================

-- Start transaction
BEGIN;

-- Disable foreign key checks temporarily (PostgreSQL syntax)
-- Note: In PostgreSQL, we use SET CONSTRAINTS instead of DISABLE KEYS

-- Delete payroll filings (child of payroll_monthly_runs)
DELETE FROM payroll_filings;

-- Delete payroll audit logs
DELETE FROM payroll_audit_logs;

-- Delete payroll adjustments
DELETE FROM payroll_adjustments;

-- Delete payslips
DELETE FROM payslips;

-- Delete payroll transactions
DELETE FROM payroll_transactions;

-- Delete payroll items (child table - delete before parent)
DELETE FROM payroll_items;

-- Delete pay run items (legacy)
DELETE FROM pay_run_items;

-- Delete pay runs (legacy)
DELETE FROM pay_runs;

-- Delete payrolls (legacy table)
DELETE FROM payrolls;

-- Delete reimbursements (if any are linked to payroll runs)
-- Note: Keeping reimbursements as they may not be payroll-specific
-- If you want to delete them too, uncomment below:
-- DELETE FROM reimbursements;

-- Finally, delete the main payroll monthly runs (parent table)
DELETE FROM payroll_monthly_runs;

-- Reset sequences for auto-increment fields (PostgreSQL specific)
-- This ensures ID sequences start fresh
ALTER SEQUENCE IF EXISTS payroll_monthly_runs_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payroll_items_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS pay_runs_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS pay_run_items_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payrolls_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payslips_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payroll_transactions_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payroll_adjustments_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payroll_audit_logs_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS payroll_filings_id_seq RESTART WITH 1;

-- Commit transaction
COMMIT;

-- Verify deletion
SELECT 'Payroll Data Cleared Successfully!' AS status;
SELECT COUNT(*) AS remaining_monthly_runs FROM payroll_monthly_runs;
SELECT COUNT(*) AS remaining_payroll_items FROM payroll_items;
SELECT COUNT(*) AS remaining_payslips FROM payslips;
SELECT COUNT(*) AS remaining_pay_runs FROM pay_runs;
