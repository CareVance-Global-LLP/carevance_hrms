/**
 * One page size for every admin-facing record list.
 *
 * These lists are *scanned*, newest-first, for the one row that answers a
 * question — they are not read end to end. So a page only has to hold enough
 * rows to recognise the right one, and every row past that is scrolling the
 * admin has to do before they can page forward.
 *
 * The project had drifted to seven different answers: 50 for the activity
 * timeline and both payroll pickers, 30 for notifications, 25 for assets and
 * the productivity rules, 10 for audit logs. The timeline was the visible
 * symptom — an ordinary day of 46 events arrived as "Page 1 of 1", so finding
 * 2pm meant scrolling rather than paging — but the inconsistency was its own
 * problem: the same gesture moved a different distance on every screen.
 *
 * Fifteen is deliberately under one screenful. Paired with `scrollBody` on
 * DataTable, which caps the table and pins its header, the page itself stops
 * growing with the data: the column headers and the pager stay where they are
 * no matter how much history exists behind them.
 *
 * Lists already at or below this are left alone — raising them to 15 would add
 * scrolling, which is the opposite of the point.
 */
export const LIST_PAGE_SIZE = 15;

/**
 * Height cap for a scrolling table body.
 *
 * Viewport-relative rather than a fixed pixel height on purpose: a large
 * monitor shows the whole page of 15 without scrolling at all, a laptop scrolls
 * a little *inside* the table, and in both cases the header row and the pager
 * below it never move off screen.
 */
export const LIST_MAX_BODY_HEIGHT = 'max-h-[60vh]';
