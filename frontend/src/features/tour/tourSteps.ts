import type { DriveStep } from 'driver.js';

/**
 * Stable hooks for the guided tour.
 *
 * Anchored to `data-tour` attributes rather than class names, because the
 * classes here are Tailwind utility strings that change whenever the layout is
 * touched — a tour that silently loses its anchors is worse than no tour, since
 * driver.js skips a step whose element is missing and the walkthrough quietly
 * gets shorter.
 */
export const TOUR_ANCHORS = {
  setupCard: 'setup-card',
  nav: 'primary-nav',
  navEmployees: 'nav-employees',
  navAttendance: 'nav-attendance',
  navReports: 'nav-reports',
  navPayroll: 'nav-payroll',
  settings: 'settings-link',
} as const;

/**
 * Route -> anchor, so the sidebar can stamp its own links without the tour
 * needing to know how nav items are rendered. Routes absent from this map get
 * no attribute.
 */
export const TOUR_ANCHOR_BY_ROUTE: Record<string, string | undefined> = {
  '/employees': TOUR_ANCHORS.navEmployees,
  '/attendance': TOUR_ANCHORS.navAttendance,
  '/reports': TOUR_ANCHORS.navReports,
  '/payroll': TOUR_ANCHORS.navPayroll,
};

const anchor = (name: string) => `[data-tour="${name}"]`;

/**
 * The walkthrough, in order.
 *
 * A step whose element is absent is dropped before the tour starts rather than
 * left for driver.js to skip, so the step counter ("2 of 5") stays honest.
 */
export function buildTourSteps(options: { includesPayroll: boolean }): DriveStep[] {
  const steps: DriveStep[] = [
    {
      element: anchor(TOUR_ANCHORS.setupCard),
      popover: {
        title: 'Start here',
        description:
          'Your setup checklist. Each item completes itself once the underlying thing is done, so you can leave and come back.',
      },
    },
    {
      element: anchor(TOUR_ANCHORS.navEmployees),
      popover: {
        title: 'Add your people',
        description:
          'Invite your team or create accounts directly. Everyone you add takes a seat on your plan.',
      },
    },
    {
      element: anchor(TOUR_ANCHORS.navAttendance),
      popover: {
        title: 'Attendance and leave',
        description:
          'Check-ins, timesheets and leave requests land here for approval once your team starts tracking.',
      },
    },
    {
      element: anchor(TOUR_ANCHORS.navReports),
      popover: {
        title: 'Reports',
        description: 'Worked hours, productivity and activity, exportable to CSV.',
      },
    },
  ];

  if (options.includesPayroll) {
    steps.push({
      element: anchor(TOUR_ANCHORS.navPayroll),
      popover: {
        title: 'Payroll',
        description:
          'Salary structures, statutory compliance and filings. The setup wizard walks you through it the first time.',
      },
    });
  }

  steps.push({
    element: anchor(TOUR_ANCHORS.settings),
    popover: {
      title: 'Settings',
      description:
        'Working hours, leave policy and your company profile — including the billing address your invoice is raised against.',
    },
  });

  return steps;
}

/** Drop steps whose anchor is not on the page, so the counter stays accurate. */
export function presentSteps(steps: DriveStep[]): DriveStep[] {
  return steps.filter((step) =>
    typeof step.element === 'string' ? document.querySelector(step.element) !== null : true
  );
}
