import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Menu, MoreHorizontal, X } from 'lucide-react';
import type { User } from '@/types';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import TopNavigation from '@/components/dashboard/TopNavigation';
import type { NavGroup } from '@/navigation/dashboardNavigation';
import BrandLogo from '@/components/branding/BrandLogo';
import { cn } from '@/utils/cn';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { resolveUserRoleLabel } from '@/lib/permissions';

interface DashboardTopbarProps {
  user?: User | null;
  organizationName?: string;
  organizationLogoUrl?: string;
  groups: NavGroup[];
  unreadNotifications: number;
  notificationsOpen: boolean;
  profileOpen: boolean;
  mobileNavigationOpen: boolean;
  onToggleMobileNavigation: () => void;
  onToggleNotifications: () => void;
  onToggleProfile: () => void;
  onCloseMobileNavigation: () => void;
  onOpenExternal?: (path: string) => void;
  notificationPanel?: ReactNode;
  profilePanel?: ReactNode;
  profileHasUnreadUpdate?: boolean;
}

export default function DashboardTopbar({
  user,
  organizationName,
  organizationLogoUrl,
  groups,
  unreadNotifications,
  notificationsOpen,
  profileOpen,
  mobileNavigationOpen,
  onToggleMobileNavigation,
  onToggleNotifications,
  onToggleProfile,
  onCloseMobileNavigation,
  onOpenExternal,
  notificationPanel,
  profilePanel,
  profileHasUnreadUpdate = false,
}: DashboardTopbarProps) {
  const location = useLocation();
  const notificationsActive = location.pathname === '/notifications';
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;
      const scrollingUp = scrollDelta < 0;

      if (currentScrollY < 24) {
        setIsVisible(true);
      } else if (scrollingUp) {
        setIsVisible(true);
      } else if (scrollDelta > 3) {
        setIsVisible(false);
      }

      lastScrollY = currentScrollY;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll);

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      className={`sticky top-0 z-30 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
        isVisible || mobileNavigationOpen || notificationsOpen || profileOpen ? 'translate-y-0' : '-translate-y-[115%]'
      }`}
    >
      <div className="w-full px-0 pt-3 lg:pt-4">
        <AdaptiveSurface
          className="relative w-full overflow-visible rounded-lg border border-slate-200 bg-white px-3.5 py-2 shadow-sm md:px-4 xl:px-5"
          tone="light"
          backgroundColor="#ffffff"
        >
          <div className="flex min-h-[4.25rem] items-center gap-3">
            <div className="flex min-w-0 items-center gap-3 shrink-0">
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white contrast-text-secondary shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80 lg:hidden"
                onClick={onToggleMobileNavigation}
                aria-label={mobileNavigationOpen ? 'Close navigation' : 'Open navigation'}
                aria-expanded={mobileNavigationOpen}
              >
                {mobileNavigationOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <div className="flex min-w-0 items-center lg:hidden">
                <BrandLogo variant="icon" size="sm" className="rounded-xl sm:hidden" />
                <BrandLogo variant="full" size="sm" className="hidden w-[9.5rem] sm:flex" />
              </div>

              <div className="hidden min-w-0 items-center lg:flex">
                <div className="flex min-w-0 items-center gap-4 xl:gap-5">
                  <BrandLogo variant="full" size="sm" className="max-w-[10.75rem] xl:max-w-[11.75rem]" />
                  {organizationName ? (
                    <div className="ml-0.5 flex min-w-0 flex-col items-center justify-center">
                      {organizationLogoUrl ? (
                        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                          <img src={organizationLogoUrl} alt={`${organizationName} logo`} className="h-full w-full object-contain" />
                        </span>
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-md bg-slate-200 text-lg font-semibold text-slate-600">
                          {organizationName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className="mt-1.5 max-w-[9.5rem] truncate text-center text-xs font-medium leading-tight text-slate-700">{organizationName}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0 hidden lg:flex lg:justify-center">
              <TopNavigation groups={groups} onOpenExternal={onOpenExternal} />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-2.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={onToggleNotifications}
                  onMouseDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  aria-haspopup="menu"
                  aria-expanded={notificationsOpen}
                  aria-label="Notifications"
                  className={cn(
                    'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80',
                    notificationsOpen || notificationsActive
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : 'border-slate-200 bg-white contrast-text-secondary hover:bg-white'
                  )}
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotifications > 0 ? (
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                  ) : null}
                </button>
                {notificationPanel}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={onToggleProfile}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  aria-label={`${user?.name || 'Account'}${profileHasUnreadUpdate ? ' account, desktop update available' : ''}`}
                  className={cn(
                    'relative flex h-11 shrink-0 items-center rounded-lg border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80',
                    profileOpen
                      ? 'border-sky-200 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white hover:bg-white',
                    'gap-2 px-2 sm:gap-3 sm:px-3'
                  )}
                >
                  {user?.avatar ? (
                    <img src={resolveMediaUrl(user.avatar)} alt={user.name || 'Profile'} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0f172a,#0284c7)] text-xs font-semibold text-white">
                      {user?.name?.charAt(0).toUpperCase() || 'A'}
                    </div>
                  )}
                  {profileHasUnreadUpdate ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />
                  ) : null}
                  <div className="min-w-0 text-left">
                    <p className="max-w-[7rem] truncate text-sm font-semibold contrast-text-primary sm:max-w-[9rem]">{user?.name || 'Admin'}</p>
                    <p className="hidden text-xs capitalize contrast-text-muted sm:block">{resolveUserRoleLabel(user)}</p>
                  </div>
                </button>
                {profilePanel}
              </div>
            </div>
          </div>

          {mobileNavigationOpen ? (
            <div className="mt-3 border-t border-slate-200/70 pt-4 lg:hidden">
              <TopNavigation
                groups={groups}
                mobile
                onNavigate={onCloseMobileNavigation}
                onOpenExternal={onOpenExternal}
              />
            </div>
          ) : null}
        </AdaptiveSurface>
      </div>
    </div>
  );
}
