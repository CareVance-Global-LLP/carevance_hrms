/**
 * The card at the foot of the rail.
 *
 * The nav previously just stopped, which left the rail feeling unfinished and
 * gave the timer nowhere to sit. This is an anchor, not a relocation — the
 * account menu stays in the header, so nothing anyone has already learned moves.
 */

import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import SidebarTooltip from '@/components/navigation/SidebarTooltip';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { cn } from '@/utils/cn';

export interface SidebarUserProps {
  name?: string | null;
  roleLabel?: string | null;
  avatar?: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
}

const initialsOf = (name?: string | null) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'U';

export default function SidebarUser({ name, roleLabel, avatar, collapsed, onNavigate }: SidebarUserProps) {
  const displayName = String(name || 'Account').trim();
  const role = String(roleLabel || '').trim();
  const avatarUrl = resolveMediaUrl(avatar);

  return (
    <SidebarTooltip label={displayName} detail={role || undefined} enabled={collapsed}>
      {(tooltipProps) => (
        <Link
          ref={tooltipProps.ref as (node: HTMLAnchorElement | null) => void}
          to="/settings?tab=profile"
          onClick={onNavigate}
          aria-describedby={tooltipProps['aria-describedby']}
          onMouseEnter={tooltipProps.onMouseEnter}
          onMouseLeave={tooltipProps.onMouseLeave}
          onFocus={tooltipProps.onFocus}
          onBlur={tooltipProps.onBlur}
          className={cn(
            'flex items-center gap-2.5 rounded-lg py-1.5 transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
            collapsed ? 'justify-center px-1.5' : 'px-2'
          )}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--sidebar-active)] to-[#28454A] text-[11px] font-bold text-white"
            >
              {initialsOf(displayName)}
            </span>
          )}

          {collapsed ? (
            <span className="sr-only">
              {displayName}
              {role ? `, ${role}` : ''} — open profile settings
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12.5px] font-semibold text-white">{displayName}</span>
                {role ? <span className="block truncate text-[10px] capitalize text-white/50">{role}</span> : null}
              </span>
              <Settings className="h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden="true" />
            </>
          )}
        </Link>
      )}
    </SidebarTooltip>
  );
}
