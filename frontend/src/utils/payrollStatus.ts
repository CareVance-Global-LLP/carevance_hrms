export type PayrollBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Single source of truth for mapping arbitrary payroll / checklist
 * status strings onto a StatusBadge tone.
 *
 * - draft / pending / failed (checklist) / warning / in_review / submitted
 *   → warning
 * - approved / paid / disbursed / closed / passed / active → success
 * - rejected / error / failed (run) / cancelled → danger
 * - everything else → neutral
 */
export function payrollStatusTone(status?: string | null): PayrollBadgeTone {
  if (!status) return 'neutral';
  const s = status.toString().toLowerCase();

  switch (s) {
    case 'approved':
    case 'paid':
    case 'disbursed':
    case 'closed':
    case 'passed':
    case 'active':
    case 'completed':
    case 'success':
      return 'success';

    case 'draft':
    case 'pending':
    case 'in_review':
    case 'submitted':
    case 'warning':
    case 'processing':
    case 'on_hold':
    case 'review':
      return 'warning';

    case 'rejected':
    case 'error':
    case 'failed':
    case 'cancelled':
    case 'canceled':
    case 'declined':
      return 'danger';

    default:
      return 'neutral';
  }
}

/**
 * Maps a payroll status onto the StatusBadge tone used for *checks*
 * inside the pre-payroll checklist (passed / failed / warning / pending).
 * Kept separate because that vocabulary is intentionally different.
 */
export function checklistCheckTone(
  status?: string | null
): PayrollBadgeTone {
  if (!status) return 'neutral';
  const s = status.toString().toLowerCase();
  switch (s) {
    case 'passed':
    case 'pass':
    case 'ok':
      return 'success';
    case 'failed':
    case 'fail':
    case 'error':
      return 'danger';
    case 'warning':
    case 'warn':
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Convert an enum-ish status string into a human-friendly title case,
 * e.g. "in_review" → "In Review", "PAID" → "Paid".
 */
export function titleCase(status?: string | null): string {
  if (!status) return '';
  const spaced = status.toString().replace(/[_-]+/g, ' ').trim();
  return spaced
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
