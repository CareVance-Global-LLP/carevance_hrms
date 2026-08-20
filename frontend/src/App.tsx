import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { canAccess, hasAdminAccess, hasEmployeeOrManagerAccess, hasStrictAdminAccess, hasSuperAdminAccess, isEmployeeUser } from '@/lib/permissions';
import { usePlan } from '@/hooks/usePlan';
import { resolveTrackerPolicy } from '@/lib/trackerPolicy';
import { isLikelyMobile } from '@/lib/mobile';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

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
const CheckoutPage = lazyWithChunkRetry(() => import('@/pages/CheckoutPage'));
const PrivacyPolicyPage = lazyWithChunkRetry(() => import('@/pages/PrivacyPolicyPage'));
const TermsPage = lazyWithChunkRetry(() => import('@/pages/TermsPage'));
const PaymentPage = lazyWithChunkRetry(() => import('@/pages/PaymentPage'));
const OwnerSignupPage = lazyWithChunkRetry(() => import('@/pages/OwnerSignupPage'));
const ContactSalesPage = lazyWithChunkRetry(() => import('@/pages/ContactSalesPage'));
const SupportPage = lazyWithChunkRetry(() => import('@/pages/SupportPage'));
const AcceptInvitePage = lazyWithChunkRetry(() => import('@/pages/AcceptInvitePage'));
const EmployeeMobileDashboard = lazyWithChunkRetry(() => import('@/pages/EmployeeMobileDashboard'));
const GeofenceSettings = lazyWithChunkRetry(() => import('@/pages/GeofenceSettings'));
const RoleManagement = lazyWithChunkRetry(() => import('@/pages/RoleManagement'));
const SelfieMapView = lazyWithChunkRetry(() => import('@/pages/SelfieMapView'));
const Layout = lazyWithChunkRetry(() => import('@/components/Layout'));
const Login = lazyWithChunkRetry(() => import('@/pages/Login'));
const ForgotPasswordPage = lazyWithChunkRetry(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithChunkRetry(() => import('@/pages/ResetPasswordPage'));
const VerifyEmailPage = lazyWithChunkRetry(() => import('@/pages/VerifyEmailPage'));
const ProfileOnboardingPage = lazyWithChunkRetry(() => import('@/pages/ProfileOnboardingPage'));
const Dashboard = lazyWithChunkRetry(() => import('@/pages/Dashboard'));
const MyTeam = lazyWithChunkRetry(() => import('@/pages/MyTeam'));
const MyActivity = lazyWithChunkRetry(() => import('@/pages/MyActivity'));
const OrganizationTree = lazyWithChunkRetry(() => import('@/pages/OrganizationTree'));
const AdminDashboard = lazyWithChunkRetry(() => import('@/pages/AdminDashboard'));
const DesktopTimerDashboard = lazyWithChunkRetry(() => import('@/pages/DesktopTimerDashboard'));
const Projects = lazyWithChunkRetry(() => import('@/pages/Projects'));
const Tasks = lazyWithChunkRetry(() => import('@/pages/Tasks'));
const TaskTimeReports = lazyWithChunkRetry(() => import('@/pages/TimeReports'));
const Timesheets = lazyWithChunkRetry(() => import('@/pages/Timesheets'));
const Invoices = lazyWithChunkRetry(() => import('@/pages/Invoices'));
const Settings = lazyWithChunkRetry(() => import('@/pages/Settings'));
const Monitoring = lazyWithChunkRetry(() => import('@/pages/Monitoring'));
const Attendance = lazyWithChunkRetry(() => import('@/pages/Attendance'));
const Chat = lazyWithChunkRetry(() => import('@/pages/Chat'));
const AuditLogs = lazyWithChunkRetry(() => import('@/pages/AuditLogs'));
const ApprovalInbox = lazyWithChunkRetry(() => import('@/pages/ApprovalInbox'));
const NotificationsCenter = lazyWithChunkRetry(() => import('@/pages/NotificationsCenter'));
const ReportsWorkspace = lazyWithChunkRetry(() => import('@/pages/ReportsWorkspace'));
const MonitoringWorkspace = lazyWithChunkRetry(() => import('@/pages/MonitoringWorkspace'));
const NewHiresPage = lazyWithChunkRetry(() => import('@/pages/NewHiresPage'));
const ExitsPage = lazyWithChunkRetry(() => import('@/pages/ExitsPage'));
const EmployeeManagementWorkspace = lazyWithChunkRetry(() => import('@/pages/EmployeeManagementWorkspace'));
const EmployeePersonalDetailsPage = lazyWithChunkRetry(() => import('@/pages/EmployeePersonalDetailsPage'));
const Assets = lazyWithChunkRetry(() => import('@/pages/Assets'));
const ResignationPage = lazyWithChunkRetry(() => import('@/pages/ResignationPage'));
const MyResignationStatusPage = lazyWithChunkRetry(() => import('@/pages/MyResignationStatusPage'));
const AddUserPage = lazyWithChunkRetry(() => import('@/pages/AddUserPage'));
const BillingSettingsPage = lazyWithChunkRetry(() => import('@/pages/BillingSettingsPage'));
const SuperAdminDashboard = lazyWithChunkRetry(() => import('@/pages/super-admin/SuperAdminDashboard'));
const SuperAdminOrganizations = lazyWithChunkRetry(() => import('@/pages/super-admin/Organizations'));
const SuperAdminCompanies = lazyWithChunkRetry(() => import('@/pages/super-admin/Companies'));
const SuperAdminCompanyDetail = lazyWithChunkRetry(() => import('@/pages/super-admin/CompanyDetail'));
const SuperAdminOrganizationDetail = lazyWithChunkRetry(() => import('@/pages/super-admin/OrganizationDetail'));
const SuperAdminCreateOrganization = lazyWithChunkRetry(() => import('@/pages/super-admin/CreateOrganization'));
const SuperAdminUsers = lazyWithChunkRetry(() => import('@/pages/super-admin/Users'));
const SuperAdminBilling = lazyWithChunkRetry(() => import('@/pages/super-admin/Billing'));
const SuperAdminPlans = lazyWithChunkRetry(() => import('@/pages/super-admin/Plans'));
const GoogleSignupCompletion = lazyWithChunkRetry(() => import('@/pages/GoogleSignupCompletion'));
const PayrollShell = lazyWithChunkRetry(() => import('@/pages/payroll/PayrollShell'));
const OverviewTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/OverviewTab'));
const RunPayrollTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/RunPayrollTab'));
const UnassignedEmployeesPage = lazyWithChunkRetry(() => import('@/pages/payroll/UnassignedEmployeesPage'));
const EmployeePayTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/EmployeePayTab'));
const OperationsTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/OperationsTab'));
const TaxComplianceTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/TaxComplianceTab'));
const ReportsTab = lazyWithChunkRetry(() => import('@/pages/payroll/tabs/ReportsTab'));
const PayrollReportsPage = lazyWithChunkRetry(() => import('@/pages/PayrollReportsPage'));
const MyPayroll = lazyWithChunkRetry(() => import('@/pages/MyPayroll'));
const PayGroupSettings = lazyWithChunkRetry(() => import('@/pages/payroll/PayGroupSettings'));
// Payroll Setup (page-based onboarding)
const SetupWelcome = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupWelcome'));
const SetupDefaults = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupDefaults'));
const SetupEmployees = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupEmployees'));
const SetupCompliance = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupCompliance'));
const SetupStatutory = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupStatutory'));
const SetupPaySchedule = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupPaySchedule'));
const SetupBank = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupBank'));
const SetupTestRun = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupTestRun'));
const SetupDepartments = lazyWithChunkRetry(() => import('@/pages/payroll/setup/SetupDepartments'));

const BreakTracking = lazyWithChunkRetry(() => import('@/pages/BreakTrackingPage'));
const Performance = lazyWithChunkRetry(() => import('@/pages/PerformancePage'));
const PerformanceGoals = lazyWithChunkRetry(() => import('@/pages/PerformanceGoalsPage'));

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
  const mobile = isLikelyMobile();

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  if (mobile && !hasSuperAdminAccess(user)) {
    return <Navigate to="/mobile/dashboard" replace />;
  }

  return <Navigate to={hasSuperAdminAccess(user) ? '/super-admin' : '/dashboard'} replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, organization, isAuthenticated, isLoading, wasOfflineRestored } = useAuth();
  const location = useLocation();
  const mobile = isLikelyMobile();

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

  /*
   * Who is made to fill in the personal profile before reaching the product.
   *
   * This is an employee HR record — date of birth, gender, emergency contacts.
   * It used to catch everyone below the top hierarchy level, and an admin sits
   * at 10, so the person who had just created the workspace was asked for their
   * emergency contact's relationship before they could see anything they had
   * signed up for. Managers and employees still get it, because for them the
   * record is the point. The owner gets a checklist item instead.
   */
  const hierarchyLevel = user
    ? (user.hierarchy_level ?? (user.role === 'admin' ? 10 : user.role === 'manager' ? 50 : user.role === 'employee' ? 100 : 999))
    : 999;
  const isWorkspaceOwner = Boolean(user && organization?.owner_user_id && user.id === organization.owner_user_id);
  const requiresOnboarding = Boolean(
    user
    && user.organization_id
    && !isWorkspaceOwner
    && hierarchyLevel > 10
    && hierarchyLevel < 999
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

  // Check if user has no organization - redirect to signup
  if (!organization?.id && !wasOfflineRestored) {
    return <Navigate to="/signup-owner?message=no-organization" replace />;
  }

  const needsPayment = organization?.subscription_intent === 'paid' && organization?.subscription_status !== 'active';
  const isOnboardingRoute = location.pathname === onboardingPath;
  const isPaymentRoute = location.pathname === '/payment';

  if (needsPayment && !isPaymentRoute) {
    return <Navigate to="/payment" replace />;
  }

  if (!needsPayment && requiresOnboarding && !onboardingCompleted && !onboardingSkipped && !isOnboardingRoute && !isPaymentRoute && !wasOfflineRestored) {
    return <Navigate to={onboardingPath} replace />;
  }

  if (requiresOnboarding && onboardingCompleted && isOnboardingRoute) {
    return <Navigate to={mobile ? '/mobile/dashboard' : '/dashboard'} replace />;
  }

  if (mobile && !hasSuperAdminAccess(user) && location.pathname !== '/mobile/dashboard') {
    return <Navigate to="/mobile/dashboard" replace />;
  }

  /*
   * One boundary per page, keyed on the path.
   *
   * Every authenticated screen passes through here, so this is the one place
   * that has to know about it. Previously the only boundary was at the root,
   * which meant a render error on any single page replaced the whole
   * application — sidebar, navigation and all — and the user could not even
   * click away from the broken screen.
   */
  return (
    <RouteErrorBoundary resetKey={location.pathname}>
      {children}
    </RouteErrorBoundary>
  );
}

function PublicRoute({ children, allowAuthenticated }: { children: React.ReactNode; allowAuthenticated?: boolean }) {
  const { user, organization, isAuthenticated, isLoading, wasOfflineRestored } = useAuth();
  const location = useLocation();
  const mobile = isLikelyMobile();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    // Check if user has no organization - redirect to signup
    if (!organization?.id && !wasOfflineRestored) {
      // Allow access to signup-owner page to create organization
      if (location.pathname === '/signup-owner') {
        return <>{children}</>;
      }
      // Redirect to signup page with message
      return <Navigate to="/signup-owner?message=no-organization" replace />;
    }
    
    // Allow authenticated users to access workspace creation when explicitly in fresh signup flow
    const isFreshSignupFlow = new URLSearchParams(location.search).get('fresh') === 'true';
    if (allowAuthenticated && isFreshSignupFlow) {
      return <>{children}</>;
    }
    const needsPayment = organization?.subscription_intent === 'paid' && organization?.subscription_status !== 'active';
    if (needsPayment) {
      return <Navigate to="/payment" replace />;
    }
    if (hasSuperAdminAccess(user)) {
      return <Navigate to="/super-admin" replace />;
    }
    return <Navigate to={mobile ? '/mobile/dashboard' : '/dashboard'} replace />;
  }

  return <>{children}</>;
}

/**
 * Gate for a person's own tracker record.
 *
 * Supervisors always reach it; everyone else only where the organization has
 * enabled self-view. The API refuses independently — this exists so a direct
 * URL lands somewhere sensible instead of on an empty page.
 */
export function SelfActivityRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!resolveTrackerPolicy(user as any).can_view_own_activity) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
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

export function StrictAdminRoute({ children }: { children: React.ReactNode }) {
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

export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
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

export function PermissionRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!canAccess(user, permission)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function EmployeeOrManagerRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!hasEmployeeOrManagerAccess(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function EmployeeRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isEmployeeUser(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function PlanFeatureRoute({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { hasFeature } = usePlan();

  if (!hasFeature(feature)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/**
 * Pay group settings, as a route.
 *
 * Both registrations used to pass `onBack={function() {}}`, so the page's only
 * back control did nothing and a successful delete — which calls
 * onBack('dashboard') — left the user sitting on the settings page of a pay
 * group that no longer existed. The `:payGroupId` param was also never handed
 * to the component, so opening one group's settings rendered every group.
 */
function PayGroupSettingsRoute() {
  const navigate = useNavigate();
  const { payGroupId } = useParams();
  const id = Number(payGroupId) || undefined;

  return (
    <PayGroupSettings
      payGroupId={id}
      onBack={(target) => {
        // 'group' returns to the group's employee list; a delete ('dashboard')
        // has no group left to return to, so it falls back to the picker.
        navigate(target === 'group' && id ? `/payroll/run?payGroup=${id}` : '/payroll/run');
      }}
    />
  );
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
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/payment" element={<ProtectedRoute><PaymentPage /></ProtectedRoute>} />
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
          {/*
            /signup served InviteSignupPage, the landing page for the legacy
            `invites` system. That system has been removed (see the note in
            backend routes/api/public.php), so there is nothing here to accept.
            Redirected rather than dropped because the URL was mailed out and
            may still be bookmarked. Modern invitations land on /accept-invite.
          */}
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route
            path="/signup-owner"
            element={
              <PublicRoute allowAuthenticated>
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
            path="/google-signup-completion"
            element={
              <PublicRoute>
                <GoogleSignupCompletion />
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
            <Route path="my-team" element={<EmployeeRoute><MyTeam /></EmployeeRoute>} />
            {/* Self-view is an organization opt-in, so a direct URL has to be
                turned away as well as the nav entry hidden. */}
            <Route path="my-activity" element={<SelfActivityRoute><MyActivity /></SelfActivityRoute>} />
            <Route path="organization-tree" element={<OrganizationTree />} />
            <Route path="time-tracker" element={isSuperAdmin ? <Navigate to="/super-admin" replace /> : <DesktopTimerDashboard />} />
            <Route path="projects" element={<PlanFeatureRoute feature="project_tracking"><Projects /></PlanFeatureRoute>} />
            <Route path="tasks" element={<PlanFeatureRoute feature="task_tracking"><Tasks /></PlanFeatureRoute>} />
            <Route path="tasks/time-reports" element={<PlanFeatureRoute feature="task_tracking"><TaskTimeReports /></PlanFeatureRoute>} />
            <Route path="chat" element={<PlanFeatureRoute feature="chat"><Chat /></PlanFeatureRoute>} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="attendance/selfies-map" element={<AdminRoute><SelfieMapView /></AdminRoute>} />
            <Route path="leave" element={<PlanFeatureRoute feature="leave_management"><Attendance mode="leave" /></PlanFeatureRoute>} />
            <Route path="edit-time" element={<Attendance mode="time-edit" />} />
            <Route path="breaks" element={<ProtectedRoute><BreakTracking /></ProtectedRoute>} />
            <Route path="team" element={<Navigate to="/user-management" replace />} />
            <Route path="monitoring" element={<Navigate to="/monitoring/productive-time" replace />} />
            <Route path="monitoring/productive-time" element={<PlanFeatureRoute feature="monitoring"><AdminRoute><MonitoringWorkspace mode="productive-time" /></AdminRoute></PlanFeatureRoute>} />
            <Route path="monitoring/unproductive-time" element={<PlanFeatureRoute feature="monitoring"><AdminRoute><MonitoringWorkspace mode="unproductive-time" /></AdminRoute></PlanFeatureRoute>} />
            <Route path="monitoring/screenshots" element={<AdminRoute><MonitoringWorkspace mode="screenshots" /></AdminRoute>} />
            {/* The old app/website usage pages computed totals from a 10-event
                sample; the Web & App Usage report is the single usage surface now. */}
            <Route path="monitoring/app-usage" element={<Navigate to="/reports/web-app-usage" replace />} />
            <Route path="monitoring/website-usage" element={<Navigate to="/reports/web-app-usage" replace />} />
            <Route path="approval-inbox" element={<AdminRoute><ApprovalInbox /></AdminRoute>} />
            <Route path="reports" element={<AdminRoute><ReportsWorkspace key="reports-hub" mode="reports-hub" /></AdminRoute>} />
            <Route path="analytics" element={<AdminRoute><ReportsWorkspace key="analytics-hub" mode="analytics-hub" /></AdminRoute>} />
            <Route path="reports/attendance" element={<AdminRoute><ReportsWorkspace key="attendance" mode="attendance" /></AdminRoute>} />
            <Route path="work/timesheets" element={<AdminRoute><Timesheets /></AdminRoute>} />
            {/* The per-person hours report keeps its route — it is a real report
                and eight other modes share this workspace's shell. */}
            <Route path="reports/hours-tracked" element={<AdminRoute><ReportsWorkspace key="hours-tracked" mode="hours-tracked" /></AdminRoute>} />
            <Route path="reports/projects-tasks" element={<AdminRoute><ReportsWorkspace key="projects-tasks" mode="projects-tasks" /></AdminRoute>} />
            <Route path="reports/timeline" element={<PlanFeatureRoute feature="employee_timeline"><AdminRoute><ReportsWorkspace key="timeline" mode="timeline" /></AdminRoute></PlanFeatureRoute>} />
            <Route path="reports/web-app-usage" element={<AdminRoute><ReportsWorkspace key="web-app-usage" mode="web-app-usage" /></AdminRoute>} />
            <Route path="reports/productivity" element={<AdminRoute><ReportsWorkspace key="productivity" mode="productivity" /></AdminRoute>} />
            <Route path="reports/custom-export" element={<AdminRoute><ReportsWorkspace key="custom-export" mode="custom-export" /></AdminRoute>} />
            <Route path="invoices" element={<AdminRoute><Invoices /></AdminRoute>} />
            <Route path="user-management" element={<Navigate to="/employees" replace />} />
            <Route path="employees" element={<AdminRoute><EmployeeManagementWorkspace mode="employees" /></AdminRoute>} />
            <Route path="employees/:employeeCode" element={<AdminRoute><EmployeePersonalDetailsPage /></AdminRoute>} />
            <Route path="employees/teams" element={<AdminRoute><EmployeeManagementWorkspace mode="teams" /></AdminRoute>} />
            <Route path="employees/invitations" element={<AdminRoute><EmployeeManagementWorkspace mode="invitations" /></AdminRoute>} />
            <Route path="employees/roles" element={<AdminRoute><EmployeeManagementWorkspace mode="roles" /></AdminRoute>} />
            <Route path="assets" element={<PermissionRoute permission="assets.view"><Assets /></PermissionRoute>} />
            <Route path="new-hires" element={<AdminRoute><NewHiresPage /></AdminRoute>} />
            {/* The old Resignations page never read the resignations table — it
                filtered the user list by `employment_status`. Exits reads real
                records, so this redirects rather than keeping two answers. */}
            <Route path="resignations" element={<Navigate to="/exits" replace />} />
            <Route path="exits" element={<AdminRoute><ExitsPage /></AdminRoute>} />
            <Route path="resignation" element={<ResignationPage />} />
            <Route path="resignation/status" element={<MyResignationStatusPage />} />
            <Route path="audit-logs" element={<AdminRoute><AuditLogs /></AdminRoute>} />
            <Route path="add-user" element={<StrictAdminRoute><AddUserPage /></StrictAdminRoute>} />
            <Route path="users/add-user" element={<StrictAdminRoute><AddUserPage /></StrictAdminRoute>} />
            <Route path="notifications" element={<NotificationsCenter />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/integrations" element={<Settings />} />
            <Route path="settings/custom-fields" element={<Settings />} />
            <Route path="settings/billing" element={<StrictAdminRoute><BillingSettingsPage /></StrictAdminRoute>} />
            <Route path="settings/geofence" element={<AdminRoute><GeofenceSettings /></AdminRoute>} />
            <Route path="settings/roles" element={<AdminRoute><RoleManagement /></AdminRoute>} />
            {/* Payroll module — single shell with 6 deep-linkable tabs */}
            <Route path="payroll" element={<PlanFeatureRoute feature="payroll"><AdminRoute><PayrollShell /></AdminRoute></PlanFeatureRoute>}>
              <Route index element={<OverviewTab />} />
              <Route path="run" element={<RunPayrollTab />} />
              <Route path="employee-pay" element={<EmployeePayTab />} />
              <Route path="operations" element={<OperationsTab />} />
              <Route path="tax-compliance" element={<TaxComplianceTab />} />
              <Route path="reports" element={<PayrollReportsPage />} />
            </Route>
            {/* Pay Group Settings - standalone page for configuring pay group state and statutory details */}
            <Route path="payroll/pay-group-settings" element={<PlanFeatureRoute feature="payroll"><StrictAdminRoute><PayGroupSettingsRoute /></StrictAdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/pay-group-settings/:payGroupId" element={<PlanFeatureRoute feature="payroll"><StrictAdminRoute><PayGroupSettingsRoute /></StrictAdminRoute></PlanFeatureRoute>} />
            {/* Standalone Unassigned Employees screen (not a tab) */}
            <Route path="payroll/unassigned-employees" element={<PlanFeatureRoute feature="payroll"><AdminRoute><UnassignedEmployeesPage /></AdminRoute></PlanFeatureRoute>} />
            <Route path="my-payroll" element={<PlanFeatureRoute feature="payroll"><ProtectedRoute><MyPayroll /></ProtectedRoute></PlanFeatureRoute>} />

            {/* Legacy payroll routes → redirect into the new tabbed shell */}
            <Route path="tax-declarations" element={<Navigate to="/payroll/tax-compliance?panel=declarations" replace />} />
            <Route path="tax-proofs" element={<Navigate to="/payroll/tax-compliance?panel=proofs" replace />} />
            <Route path="tax-simulator" element={<Navigate to="/payroll/tax-compliance?panel=simulator" replace />} />
            <Route path="loans" element={<Navigate to="/payroll/employee-pay?type=loans" replace />} />
            <Route path="arrears" element={<Navigate to="/payroll/employee-pay?type=arrears" replace />} />
            <Route path="leave-encashment" element={<Navigate to="/payroll/tax-compliance?panel=leave-encashment" replace />} />
            <Route path="fnf-settlements" element={<Navigate to="/payroll/tax-compliance?panel=fnf" replace />} />
            <Route path="salary-revisions" element={<Navigate to="/payroll/employee-pay?type=revisions" replace />} />
            <Route path="fbp" element={<Navigate to="/payroll/employee-pay?type=fbp" replace />} />
            <Route path="perquisites" element={<Navigate to="/payroll/employee-pay?type=perquisites" replace />} />
            <Route path="payroll-reports" element={<Navigate to="/payroll/reports?panel=register" replace />} />

            {/* Payroll Setup (page-based onboarding) */}
            <Route path="payroll/setup" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupWelcome /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/defaults" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupDefaults /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/employees" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupEmployees /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/compliance" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupCompliance /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/statutory" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupStatutory /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/pay-schedule" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupPaySchedule /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/bank" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupBank /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/departments" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupDepartments /></AdminRoute></PlanFeatureRoute>} />
            <Route path="payroll/setup/test-run" element={<PlanFeatureRoute feature="payroll"><AdminRoute><SetupTestRun /></AdminRoute></PlanFeatureRoute>} />
            <Route path="reimbursements" element={<Navigate to="/payroll/employee-pay?type=reimbursements" replace />} />
            <Route path="pre-payroll-checklist" element={<Navigate to="/payroll/run?step=checklist" replace />} />
            <Route path="filings" element={<Navigate to="/payroll/reports?panel=filings" replace />} />
            <Route path="performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
            <Route path="performance-goals" element={<ProtectedRoute><PerformanceGoals /></ProtectedRoute>} />
            <Route path="super-admin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
            <Route path="super-admin/dashboard" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
            <Route path="super-admin/organizations" element={<SuperAdminRoute><SuperAdminOrganizations /></SuperAdminRoute>} />
            <Route path="super-admin/organizations/:organizationId" element={<SuperAdminRoute><SuperAdminOrganizationDetail /></SuperAdminRoute>} />
            <Route path="super-admin/organizations/create" element={<SuperAdminRoute><SuperAdminCreateOrganization /></SuperAdminRoute>} />
            <Route path="super-admin/companies" element={<SuperAdminRoute><SuperAdminCompanies /></SuperAdminRoute>} />
            <Route path="super-admin/companies/:companyId" element={<SuperAdminRoute><SuperAdminCompanyDetail /></SuperAdminRoute>} />
            <Route path="super-admin/users" element={<SuperAdminRoute><SuperAdminUsers /></SuperAdminRoute>} />
            <Route path="super-admin/billing" element={<SuperAdminRoute><SuperAdminBilling /></SuperAdminRoute>} />
            <Route path="super-admin/plans" element={<SuperAdminRoute><SuperAdminPlans /></SuperAdminRoute>} />
            <Route path="legacy/monitoring" element={<AdminRoute><Monitoring /></AdminRoute>} />
            {/*
              `legacy/user-management` was removed here.

              It was a fifth way to create an employee — a 729-line page calling
              userApi.create with its own field set — and nothing in the app
              linked to it, so it was reachable only by typing the path. Keeping
              an unlinked create path alive meant every fix to the add-employee
              flow had one more place to miss. Add User covers what it did.
            */}
          </Route>
          <Route
            path="mobile/dashboard"
            element={
              <ProtectedRoute>
                <EmployeeMobileDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </>
    </Suspense>
  );
}

export default App;
