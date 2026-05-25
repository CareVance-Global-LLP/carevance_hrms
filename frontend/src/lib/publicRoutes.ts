const authenticatedPrefixes = [
  '/dashboard',
  '/projects',
  '/tasks',
  '/chat',
  '/attendance',
  '/edit-time',
  '/team',
  '/monitoring',
  '/approval-inbox',
  '/reports',
  '/invoices',
  '/payroll',
  '/user-management',
  '/employees',
  '/audit-logs',
  '/add-user',
  '/users/add-user',
  '/notifications',
  '/settings',
  '/legacy',
  '/desktop-web-dashboard',
  '/desktop-web-payroll',
];

export function isAuthenticatedAppPath(pathname: string) {
  return authenticatedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isPublicExperiencePath(pathname: string) {
  return !isAuthenticatedAppPath(pathname);
}

export function isIndexableMarketingPath(pathname: string) {
  return [
    '/',
    '/pricing',
    '/contact-sales',
    '/support',
    '/privacy',
    '/terms',
    '/signup-owner',
    '/start-trial',
    '/register',
  ].includes(pathname);
}
