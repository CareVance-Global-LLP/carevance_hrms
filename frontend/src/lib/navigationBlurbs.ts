/**
 * One line describing what each navigation group is for.
 *
 * Keyed by group label rather than added to `NavGroup`, because the type is
 * declared twice — once in `dashboardNavigation.ts` and again in
 * `condensedNavigation.ts` — and both configs use the same labels. One map
 * serves both, and a label with no entry simply renders without a description
 * rather than breaking.
 *
 * Written from the reader's side: what you would go there to do, not what the
 * module is called internally.
 */
export const GROUP_BLURBS: Record<string, string> = {
  People: 'Directory, joiners and leavers',
  'ROLES & PERMISSIONS': 'Who can see and do what',
  Attendance: 'Presence, leave and approvals',
  Monitoring: 'Activity, screenshots and usage',
  Performance: 'Reviews, goals and feedback',
  Work: 'Projects, tasks and timesheets',
  Communication: 'Announcements and chat',
  Assets: 'Equipment and allocations',
  Reports: 'Exports and analytics',
  Payroll: 'Runs, payslips and compliance',
  Settings: 'Organisation and preferences',
  Resignation: 'Notice and handover',
};

export const blurbFor = (label: string): string | undefined => GROUP_BLURBS[label];
