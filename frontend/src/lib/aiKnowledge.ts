export const QUICK_ACTIONS = [
  'How do I submit a leave request?',
  'Where can I see my attendance and time?',
  'How do I track my time / start the timer?',
  'Where are reports and analytics?',
];

// Reference knowledge base used for the AI assistant quick-action chips.
// The authoritative system prompt lives in the backend AiChatService; this is a
// frontend-only mirror used to seed suggested questions.
export const APP_KNOWLEDGE = {
  navigation: [
    { name: 'Dashboard', route: '/dashboard', description: 'Organization overview with today\'s stats.' },
    { name: 'Organization Tree', route: '/organization-tree', description: 'View company hierarchy.', adminOnly: true },
    { name: 'Employees', route: '/employees', description: 'Browse and manage people.', adminOnly: true },
    { name: 'New Hires', route: '/new-hires', description: 'Recently onboarded employees.', adminOnly: true },
    { name: 'Resignations', route: '/resignations', description: 'Active and past resignations.', adminOnly: true },
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
    { name: 'Monitoring', route: '/monitoring/productive-time', description: 'Productivity and app usage.', adminOnly: true, planFeature: 'monitoring' },
    { name: 'Screenshots', route: '/monitoring/screenshots', description: 'Monitored screenshots.', adminOnly: true, planFeature: 'monitoring' },
    { name: 'Selfies Map', route: '/attendance/selfies-map', description: 'Attendance selfie locations.', adminOnly: true },
    { name: 'Performance Reviews', route: '/performance', description: 'Performance cycles and reviews.' },
    { name: 'Goals', route: '/performance-goals', description: 'Individual and team goals.' },
    { name: 'My Expenses', route: '/expenses', description: 'Submit and track expense claims.' },
    { name: 'Timesheets', route: '/reports/hours-tracked', description: 'Tracked hours report.', adminOnly: true },
    { name: 'Projects', route: '/projects', description: 'Project tracking.', planFeature: 'project_tracking' },
    { name: 'Tasks', route: '/tasks', description: 'Task board and assignments.', planFeature: 'task_tracking' },
    { name: 'Reports', route: '/reports', description: 'Consolidated reports.', adminOnly: true },
    { name: 'Analytics', route: '/analytics', description: 'People analytics.', adminOnly: true },
    { name: 'Settings', route: '/settings', description: 'Workspace and org settings.', adminOnly: true },
  ],
  workflows: [
    { name: 'Submit Leave', steps: ['Go to /leave', 'Pick start and end dates', 'Choose a category (Paid/Sick/Birthday/Unpaid)', 'Choose full day or half day', 'Add a reason', 'Submit'] },
    { name: 'Approve Leave', steps: ['Go to /approval-inbox', 'Open the pending leave request', 'Click Approve or Reject', 'Add a note if needed'] },
    { name: 'Track Time', steps: ['Open the desktop app timer', 'Start the timer when you begin', 'Use /breaks to log breaks', 'Stop the timer when done'] },
    { name: 'Submit Expense', steps: ['Go to /expenses', 'Add the claim details', 'Attach a receipt', 'Submit for review'] },
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
