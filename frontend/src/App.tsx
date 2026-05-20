import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess, hasStrictAdminAccess, hasSuperAdminAccess } from '@/lib/permissions';

const lazyWithChunkRetry = <T extends { default: React.ComponentType<any> }>(
  importer: () => Promise<T>
) => lazy(async () => {
  try {
    return await importer();
  } catch (error) {
    if (isChunkLoadFailure(error)) {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const lastRecoveredPath = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);

      if (lastRecoveredPath !== currentPath) {
        window.sessionStorage.setItem(CHUNK_RELOAD_KEY, currentPath);
        window.location.reload();
      } else {
        window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      }
    }

    throw error;
  }
});

const LandingPage = lazyWithChunkRetry(() => import('@/pages/LandingPage'));
const PricingPage = lazyWithChunkRetry(() => import('@/pages/PricingPage'));
const PrivacyPolicyPage = lazyWithChunkRetry(() => import('@/pages/PrivacyPolicyPage'));
const TermsPage = lazyWithChunkRetry(() => import('@/pages/TermsPage'));
const OwnerSignupPage = lazyWithChunkRetry(() => import('@/pages/OwnerSignupPage'));
const InviteSignupPage = lazyWithChunkRetry(() => import('@/pages/InviteSignupPage'));
const ContactSalesPage = lazyWithChunkRetry(() => import('@/pages/ContactSalesPage'));
const SupportPage = lazyWithChunkRetry(() => import('@/pages/SupportPage'));
const AcceptInvitePage = lazyWithChunkRetry(() => import('@/pages/AcceptInvitePage'));
const Layout = lazyWithChunkRetry(() => import('@/components/Layout'));
const Login = lazyWithChunkRetry(() => import('@/pages/Login'));
const ForgotPasswordPage = lazyWithChunkRetry(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithChunkRetry(() => import('@/pages/ResetPasswordPage'));
const VerifyEmailPage = lazyWithChunkRetry(() => import('@/pages/VerifyEmailPage'));
const ProfileOnboardingPage = lazyWithChunkRetry(() => import('@/pages/ProfileOnboardingPage'));
const Dashboard = lazyWithChunkRetry(() => import('@/pages/Dashboard'));
const AdminDashboard = lazyWithChunkRetry(() => import('@/pages/AdminDashboard'));
const OrgHierarchy = lazyWithChunkRetry(() => import('@/pages/OrgHierarchy'));
const DesktopTimerDashboard = lazyWithChunkRetry(() => import('@/pages/DesktopTimerDashboard'));
const Projects = lazyWithChunkRetry(() => import('@/pages/Projects'));
const Tasks = lazyWithChunkRetry(() => import('@/pages/Tasks'));
const Reports = lazyWithChunkRetry(() => import('@/pages/Reports'));
const Invoices = lazyWithChunkRetry(() => import('@/pages/Invoices'));
const Settings = lazyWithChunkRetry(() => import('@/pages/Settings'));
const Monitoring = lazyWithChunkRetry(() => import('@/pages/Monitoring'));
const Attendance = lazyWithChunkRetry(() => import('@/pages/Attendance'));
const Chat = lazyWithChunkRetry(() => import('@/pages/Chat'));
const PayrollWorkspace = lazyWithChunkRetry(() => import('@/pages/PayrollWorkspace'));
const UserManagement = lazyWithChunkRetry(() => import('@/pages/UserManagement'));
const AuditLogs = lazyWithChunkRetry(() => import('@/pages/AuditLogs'));
const ApprovalInbox = lazyWithChunkRetry(() => import('@/pages/ApprovalInbox'));
const NotificationsCenter = lazyWithChunkRetry(() => import('@/pages/NotificationsCenter'));
const ReportsWorkspace = lazyWithChunkRetry(() => import('@/pages/ReportsWorkspace'));
const MonitoringWorkspace = lazyWithChunkRetry(() => import('@/pages/MonitoringWorkspace'));
const EmployeeManagementWorkspace = lazyWithChunkRetry(() => import('@/pages/EmployeeManagementWorkspace'));
const EmployeePersonalDetailsPage = lazyWithChunkRetry(() => import('@/pages/EmployeePersonalDetailsPage'));
const NewHiresPage = lazyWithChunkRetry(() => import('@/pages/NewHiresPage'));
const ResignationsPage = lazyWithChunkRetry(() => import('@/pages/ResignationsPage'));
const AddUserPage = lazyWithChunkRetry(() => import('@/pages/AddUserPage'));
const BillingSettingsPage = lazyWithChunkRetry(() => import('@/pages/BillingSettingsPage'));
const SuperAdminDashboard = lazyWithChunkRetry(() => import('@/pages/super-admin/SuperAdminDashboard'));
const SuperAdminOrganizations = lazyWithChunkRetry(() => import('@/pages/super-admin/Organizations'));
const SuperAdminCompanies = lazyWithChunkRetry(() => import('@/pages/super-admin/Companies'));
const SuperAdminCompanyDetail = lazyWithChunkRetry(() => import('@/pages/super-admin/CompanyDetail'));

const CHUNK_RELOAD_KEY = 'carevance:chunk-reload';
const isChunkLoadFailure = (error: unknown) => {
  const message = String(
    (error as { message?: string })?.message
      || (error as { reason?: { message?: string } })?.reason?.message
      || ''
  ).toLowerCase();

  return message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('chunkloaderror')
    || message.includes('loading chunk');
};

function ChunkRecoveryBridge() {
  useEffect(() => {
    const recover = () => {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const lastRecoveredPath = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);

      if (lastRecoveredPath === currentPath) {
        window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return;
      }

      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, currentPath);
      window.location.reload();
    };

    const handleWindowError = (event: ErrorEvent) => {
      if (isChunkLoadFailure(event.error || event.message)) {
        recover();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadFailure(event.reason)) {
        recover();
      }
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}

function PayrollReturnBridge() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || location.pathname !== '/') {
      return;
    }

    const params = new URLSearchParams(location.search);
    const payment = params.get('payment');
    const payrollId = params.get('payroll_id');
    const checkoutSessionId = params.get('checkout_session_id');

    if (!payment || (!payrollId && !checkoutSessionId)) {
      return;
    }

    if (!isAuthenticated) {
      navigate(`/login${location.search}`, { replace: true });
      return;
    }

    navigate(`${hasAdminAccess(user) ? '/payroll' : '/dashboard'}${location.search}`, { replace: true });
  }, [isAuthenticated, isLoading, location.pathname, location.search, navigate, user]);

  return null;
}

function HomeRoute() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (window.desktopTracker) {
    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      );
    }

    if (!isAuthenticated) {
      return <Navigate to="/login" replace />;
    }

    return <Navigate to={hasSuperAdminAccess(user) ? '/super-admin' : '/dashboard'} replace />;
  }

  return <LandingPage />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const hasOnboardingProfile = (candidate: any) => {
    if (!candidate || typeof candidate !== 'object') return false;

    const requiredFields = [
      'first_name',
      'last_name',
      'display_name',
      'gender',
      'date_of_birth',
      'phone',
      'personal_email',
      'address_line',
      'city',
      'state',
      'postal_code',
      'emergency_contact_name',
      'emergency_contact_number',
      'emergency_contact_relationship',
    ];

    return requiredFields.every((field) => String(candidate[field] || '').trim() !== '');
  };

  const requiresOnboarding = Boolean(
    user
    && ['admin', 'manager', 'employee'].includes(String(user.role || '').toLowerCase())
    && user.organization_id
  );
  const onboardingCompleted = Boolean(
    user?.settings?.profile_onboarding_completed
    || hasOnboardingProfile(user?.employee_profile)
  );
  const onboardingSkipped = Boolean(user?.settings?.profile_onboarding_skipped);
  const onboardingPath = '/onboarding/profile';

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiresOnboarding && !onboardingCompleted && !onboardingSkipped && location.pathname !== onboardingPath) {
    return <Navigate to={onboardingPath} replace />;
  }

  if (requiresOnboarding && onboardingCompleted && location.pathname === onboardingPath) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={hasSuperAdminAccess(user) ? '/super-admin' : '/dashboard'} replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!hasAdminAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function StrictAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!hasStrictAdminAccess(user)) {
    return <Navigate to="/employees" replace />;
  }

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!hasSuperAdminAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { user } = useAuth();
  const isSuperAdmin = hasSuperAdminAccess(user);
  const dashboardElement = window.desktopTracker && !isSuperAdmin ? <DesktopTimerDashboard /> : <Dashboard />;
  const effectiveDashboardElement = isSuperAdmin
    ? <SuperAdminDashboard />
    : window.desktopTracker
      ? dashboardElement
      : hasAdminAccess(user)
        ? <AdminDashboard />
        : <Dashboard />;

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
      </div>
    }>
      <>
        <ChunkRecoveryBridge />
        <PayrollReturnBridge />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/contact-sales" element={<ContactSalesPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/book-demo" element={<Navigate to="/contact-sales" replace />} />
          <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/onboarding/profile"
            element={
              <ProtectedRoute>
                <ProfileOnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <OwnerSignupPage />
              </PublicRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicRoute>
                <InviteSignupPage />
              </PublicRoute>
            }
          />
          <Route
            path="/signup-owner"
            element={
              <PublicRoute>
                <OwnerSignupPage />
              </PublicRoute>
            }
          />
          <Route
            path="/start-trial"
            element={
              <PublicRoute>
                <OwnerSignupPage defaultMode="trial" />
              </PublicRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={effectiveDashboardElement} />
            <Route path="org-hierarchy" element={<AdminRoute><OrgHierarchy /></AdminRoute>} />
            <Route path="time-tracker" element={isSuperAdmin ? <Navigate to="/super-admin" replace /> : <DesktopTimerDashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="chat" element={<Chat />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="leave" element={<Attendance mode="leave" />} />
            <Route path="edit-time" element={<Attendance mode="time-edit" />} />
            <Route path="team" element={<Navigate to="/user-management" replace />} />
            <Route path="monitoring" element={<Navigate to="/monitoring/productive-time" replace />} />
            <Route path="monitoring/productive-time" element={<AdminRoute><MonitoringWorkspace mode="productive-time" /></AdminRoute>} />
            <Route path="monitoring/unproductive-time" element={<AdminRoute><MonitoringWorkspace mode="unproductive-time" /></AdminRoute>} />
            <Route path="monitoring/screenshots" element={<AdminRoute><MonitoringWorkspace mode="screenshots" /></AdminRoute>} />
            <Route path="monitoring/app-usage" element={<AdminRoute><MonitoringWorkspace mode="app-usage" /></AdminRoute>} />
            <Route path="monitoring/website-usage" element={<AdminRoute><MonitoringWorkspace mode="website-usage" /></AdminRoute>} />
            <Route path="approval-inbox" element={<AdminRoute><ApprovalInbox /></AdminRoute>} />
            <Route path="reports" element={<AdminRoute><ReportsWorkspace key="reports-hub" mode="reports-hub" /></AdminRoute>} />
            <Route path="analytics" element={<AdminRoute><ReportsWorkspace key="analytics-hub" mode="analytics-hub" /></AdminRoute>} />
            <Route path="reports/attendance" element={<AdminRoute><ReportsWorkspace key="attendance" mode="attendance" /></AdminRoute>} />
            <Route path="reports/hours-tracked" element={<AdminRoute><ReportsWorkspace key="hours-tracked" mode="hours-tracked" /></AdminRoute>} />
            <Route path="reports/projects-tasks" element={<AdminRoute><ReportsWorkspace key="projects-tasks" mode="projects-tasks" /></AdminRoute>} />
            <Route path="reports/timeline" element={<AdminRoute><ReportsWorkspace key="timeline" mode="timeline" /></AdminRoute>} />
            <Route path="reports/web-app-usage" element={<AdminRoute><ReportsWorkspace key="web-app-usage" mode="web-app-usage" /></AdminRoute>} />
            <Route path="reports/productivity" element={<AdminRoute><ReportsWorkspace key="productivity" mode="productivity" /></AdminRoute>} />
            <Route path="reports/custom-export" element={<AdminRoute><ReportsWorkspace key="custom-export" mode="custom-export" /></AdminRoute>} />
            <Route path="invoices" element={<AdminRoute><Invoices /></AdminRoute>} />
            <Route path="payroll" element={<PayrollWorkspace mode="overview" />} />
            <Route path="payroll/runs" element={<PayrollWorkspace mode="runs" />} />
            <Route path="payroll/employees" element={<PayrollWorkspace mode="employees" />} />
            <Route path="payroll/employees/:employeeId" element={<PayrollWorkspace mode="employee-detail" />} />
            <Route path="payroll/components" element={<Navigate to="/payroll/settings" replace />} />
            <Route path="payroll/structures" element={<Navigate to="/payroll/settings" replace />} />
            <Route path="payroll/adjustments" element={<PayrollWorkspace mode="adjustments" />} />
            <Route path="payroll/reimbursements" element={<Navigate to="/payroll/adjustments" replace />} />
            <Route path="payroll/payslips" element={<PayrollWorkspace mode="payslips" />} />
            <Route path="payroll/reports" element={<PayrollWorkspace mode="reports" />} />
            <Route path="payroll/settings" element={<PayrollWorkspace mode="settings" />} />
            <Route path="user-management" element={<Navigate to="/employees" replace />} />
            <Route path="employees" element={<AdminRoute><EmployeeManagementWorkspace mode="employees" /></AdminRoute>} />
            <Route path="employees/:employeeId" element={<AdminRoute><EmployeePersonalDetailsPage /></AdminRoute>} />
            <Route path="employees/teams" element={<AdminRoute><EmployeeManagementWorkspace mode="teams" /></AdminRoute>} />
            <Route path="employees/invitations" element={<AdminRoute><EmployeeManagementWorkspace mode="invitations" /></AdminRoute>} />
            <Route path="employees/roles" element={<AdminRoute><EmployeeManagementWorkspace mode="roles" /></AdminRoute>} />
            <Route path="new-hires" element={<AdminRoute><NewHiresPage /></AdminRoute>} />
            <Route path="resignations" element={<AdminRoute><ResignationsPage /></AdminRoute>} />
            <Route path="audit-logs" element={<AdminRoute><AuditLogs /></AdminRoute>} />
            <Route path="add-user" element={<StrictAdminRoute><AddUserPage /></StrictAdminRoute>} />
            <Route path="users/add-user" element={<StrictAdminRoute><AddUserPage /></StrictAdminRoute>} />
            <Route path="notifications" element={<NotificationsCenter />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/integrations" element={<Settings />} />
            <Route path="settings/custom-fields" element={<Settings />} />
            <Route path="settings/billing" element={<AdminRoute><BillingSettingsPage /></AdminRoute>} />
            <Route path="super-admin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
            <Route path="super-admin/dashboard" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
            <Route path="super-admin/organizations" element={<SuperAdminRoute><SuperAdminOrganizations /></SuperAdminRoute>} />
            <Route path="super-admin/companies" element={<SuperAdminRoute><SuperAdminCompanies /></SuperAdminRoute>} />
            <Route path="super-admin/companies/:companyId" element={<SuperAdminRoute><SuperAdminCompanyDetail /></SuperAdminRoute>} />
            <Route path="legacy/reports" element={<AdminRoute><Reports /></AdminRoute>} />
            <Route path="legacy/monitoring" element={<AdminRoute><Monitoring /></AdminRoute>} />
            <Route path="legacy/user-management" element={<AdminRoute><UserManagement /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </>
    </Suspense>
  );
}

export default App;
