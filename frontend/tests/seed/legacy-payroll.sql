-- Seeded against the actual Live DB schema for `timetrackpro`.
-- Org: 30 (CareVance test)
-- Users: 343 (Irbaz / irbaz@test.com), 345 (Ayush / ayush@test.com)

INSERT INTO payroll_profiles (id, organization_id, user_id, payroll_code, pay_group, is_active, created_at, updated_at)
VALUES (1001, 30, 343, 'SEED-LEGACY-001', 'default', true, NOW() - INTERVAL '1 year', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll_monthly_runs (
  id, organization_id, month_year, status,
  total_employees, total_gross, total_deductions, total_net_pay,
  total_employer_contributions, total_pf_employee, total_pf_employer,
  total_esi_employee, total_esi_employer, total_pt, total_tds,
  created_by, created_at, updated_at
)
VALUES (
  2001, 30, '2026-08', 'draft',
  2, 83334, 8334, 75000,
  1500, 1500, 1500,
  0, 0, 200, 0,
  343, NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO payroll_items (
  id, payroll_run_id, organization_id, user_id, month_year,
  total_working_days, days_present, days_absent, days_leave,
  basic, hra, special_allowance, custom_earnings, gross_salary,
  pf_employee, esi_employee, pt, tds, total_deductions,
  net_pay, payment_status, created_at, updated_at
)
VALUES
  (
    3001, 2001, 30, 343, '2026-08',
    26, 26, 0, 0,
    18000, 9000, 14667, 0, 41667,
    1800, 0, 200, 0, 2000,
    37500, 'pending', NOW(), NOW()
  ),
  (
    3002, 2001, 30, 345, '2026-08',
    26, 26, 0, 0,
    18000, 9000, 14667, 0, 41667,
    1800, 0, 200, 0, 2000,
    37500, 'pending', NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;
