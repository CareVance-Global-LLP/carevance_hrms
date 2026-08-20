/**
 * Openers for the admin assistant.
 *
 * Each one maps onto a tool in App\Services\Ai\AiToolRegistry, so every chip
 * returns a live figure with a source link rather than a paragraph of
 * navigation advice. That is the point of showing them: they demonstrate the
 * assistant reads real data. A chip with no tool behind it teaches the opposite
 * lesson on first click — if you add one, add its tool too.
 *
 * The role-filtering that used to live here went with the employee-facing
 * bubble: the assistant is admin-only now, so there is one audience and one
 * list.
 */
export const ADMIN_QUICK_ACTIONS: string[] = [
  "What's waiting for my approval?",
  "Who hasn't clocked in today?",
  "Who's on leave today?",
  'What is our headcount right now?',
  'Where is payroll this cycle?',
  "Who can't be paid yet?",
];

// Reference knowledge base used for the AI assistant quick-action chips.
// The authoritative system prompt lives in the backend AiChatService; this is a
// frontend-only mirror used to seed suggested questions.
export const APP_KNOWLEDGE = {
  navigation: [
    { name: 'Dashboard', route: '/dashboard', description: 'Organization overview with today\'s stats.' },
    { name: 'Organization Tree', route: '/organization-tree', description: 'View company hierarchy.' },
    { name: 'Employees', route: '/employees', description: 'Browse and manage people.', adminOnly: true },
    { name: 'New Hires', route: '/new-hires', description: 'Recently onboarded employees.', adminOnly: true },
    { name: 'Exits', route: '/exits', description: 'Employee exits: notice, clearance, settlement.', adminOnly: true },
    { name: 'Departments', route: '/employees/teams', description: 'Department and team directory.', adminOnly: true },
    { name: 'Roles & Permissions', route: '/employees/roles', description: 'Manage role-based access.', adminOnly: true },
    { name: 'Announcements', route: '/notifications', description: 'Company announcements.', adminOnly: true },
    { name: 'My Team', route: '/my-team', description: 'Your direct reports.', employeeOnly: true },
    { name: 'Chat', route: '/chat', description: 'Direct and group messaging.', planFeature: 'chat' },
    { name: 'Attendance', route: '/attendance', description: 'Daily attendance and shifts.' },
    { name: 'Leave', route: '/leave', description: 'Submit and track leave requests.', planFeature: 'leave_management' },
    { name: 'Approval Inbox', route: '/approval-inbox', description: 'Approve leave and time-edit requests.', adminOnly: true },
    { name: 'Overtime', route: '/edit-time', description: 'Request overtime / time edits.' },
    { name: 'Breaks', route: '/breaks', description: 'Log and review breaks.' },
    { name: 'Monitoring', route: '/monitoring/productive-time', description: 'Live presence, productivity shares, and per-person rankings.', adminOnly: true, planFeature: 'monitoring' },
    { name: 'Screenshots', route: '/monitoring/screenshots', description: 'Screenshots grouped by person and hour with productivity mix.', adminOnly: true, planFeature: 'monitoring' },
    { name: 'Selfies Map', route: '/attendance/selfies-map', description: 'Punch-in selfie verification — who checked in, from where, who has not.', adminOnly: true },
    { name: 'Performance Reviews', route: '/performance', description: 'Performance cycles and reviews.' },
    { name: 'Goals', route: '/performance-goals', description: 'Individual and team goals.' },
    { name: 'Timesheets', route: '/work/timesheets', description: 'Weekly grid of hours logged per person per day.', adminOnly: true },
    { name: 'Hours Tracked', route: '/reports/hours-tracked', description: 'Per-person totals report for tracked, idle, and break time.', adminOnly: true },
    { name: 'Projects', route: '/projects', description: 'Project tracking with budget burn and deadlines.', planFeature: 'project_tracking' },
    { name: 'Tasks', route: '/tasks', description: 'Task list and board with assignments.', planFeature: 'task_tracking' },
    { name: 'Reports', route: '/reports', description: 'Consolidated reports.', adminOnly: true },
    { name: 'Analytics', route: '/analytics', description: 'People analytics.', adminOnly: true },
    { name: 'Settings', route: '/settings', description: 'Workspace and org settings.', adminOnly: true },
  ],
  workflows: [
    { name: 'Submit Leave', steps: ['Go to /leave', 'Pick start and end dates', 'Choose a category (Paid/Sick/Birthday/Unpaid)', 'Choose full day or half day', 'Add a reason', 'Submit'] },
    { name: 'Approve Leave', steps: ['Go to /approval-inbox', 'Open the pending leave request', 'Click Approve or Reject', 'Add a note if needed'] },
    { name: 'Track Time', steps: ['Open the desktop app timer', 'Start the timer when you begin', 'Use /breaks to log breaks', 'Stop the timer when done'] },
    { name: 'Approve Time Edit', steps: ['Go to /approval-inbox', 'Open the pending time-edit request', 'Click Approve or Reject'] },
  ],
  policies: [
    'Leave types: Paid, Sick, Birthday, Unpaid.',
    'Half-day leave can only be requested for a single date, not a range.',
    'Standard shift is 8 hours (28800 seconds); attendance is marked late after 10:30.',
    'Leave balance is tracked per category per cycle.',
    'Employees see their own requests; managers and admins get the Approval Inbox to act on their team\'s requests.',
  ],
};
