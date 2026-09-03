/**
 * Initials for the avatar in the ThreePanePicker.
 *
 * The same 4-line implementation previously lived in two places
 * (EmployeePayrollCards.tsx and SalaryBreakdownCards.tsx) and would have
 * drifted the third time it was needed.
 */
export function getInitials(name?: string | null, fallback = '?'): string {
  if (!name) return fallback;
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
