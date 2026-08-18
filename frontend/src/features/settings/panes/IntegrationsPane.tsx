import { useEffect, useState } from 'react';
import { ArrowRight, Bell, FileSpreadsheet, Monitor } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from '../components/SettingsCard';
import SettingRow from '../components/SettingRow';
import type { SettingsTabId } from '../types';

interface IntegrationsPaneProps {
  onOpenTab: (tab: SettingsTabId) => void;
}

/**
 * Only genuine connections get a status here, and every status is read at
 * render time. The previous version rendered four hardcoded cards whose
 * "Ready" badges were string literals in the JSX — nothing was ever checked.
 */
export default function IntegrationsPane({ onOpenTab }: IntegrationsPaneProps) {
  const isDesktopConnected = Boolean(window.desktopTracker);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktopTracker;
    if (!bridge?.getUpdateState) {
      return;
    }
    let cancelled = false;
    bridge
      .getUpdateState()
      .then((state) => {
        if (!cancelled && state?.currentVersion) {
          setDesktopVersion(state.currentVersion);
        }
      })
      .catch((error) => reportSilentError('settings.integrations.desktopVersion', error));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Connected to this workspace"
        description="Checked live, each time this page opens."
      >
        <SettingRow
          icon={Monitor}
          title="Desktop tracker"
          description={
            isDesktopConnected
              ? desktopVersion
                ? `Running in the CareVance desktop app, version ${desktopVersion}.`
                : 'Running in the CareVance desktop app.'
              : 'Attendance, screenshots and activity data come from the desktop app. Open CareVance there to connect it.'
          }
          control={
            isDesktopConnected
              ? <StatusBadge tone="success">Connected</StatusBadge>
              : <StatusBadge tone="neutral">Not detected</StatusBadge>
          }
        />
      </SettingsCard>

      <SettingsCard
        title="Elsewhere in CareVance"
        description="These are places to go rather than services to connect, so they are listed as navigation, not as integrations."
      >
        <SettingRow
          icon={FileSpreadsheet}
          title="Payroll exports"
          description="Bank transfer files, EPFO ECR and NSDL FVU downloads."
          control={
            <Link
              to="/payroll"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 underline-offset-2 hover:underline"
            >
              Open payroll <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <SettingRow
          icon={Bell}
          title="Notification preferences"
          description="Email, in-app, desktop and chat."
          control={
            <button
              type="button"
              onClick={() => onOpenTab('notifications')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 underline-offset-2 hover:underline"
            >
              Open notifications <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
      </SettingsCard>
    </div>
  );
}
