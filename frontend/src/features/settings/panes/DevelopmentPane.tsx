import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ToggleInput } from '@/components/ui/FormField';
import SettingsCard from '../components/SettingsCard';
import SettingRow from '../components/SettingRow';

export default function DevelopmentPane() {
  const [condensedNav, setCondensedNav] = useState(() => localStorage.getItem('devModeNavigation') === 'true');

  const toggleCondensedNav = (checked: boolean) => {
    setCondensedNav(checked);
    if (checked) {
      localStorage.setItem('devModeNavigation', 'true');
    } else {
      localStorage.removeItem('devModeNavigation');
    }
    // The navigation tree is built at mount, so applying it means reloading.
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <SettingsCard title="Flags" description="Only visible on dev builds, to admins.">
        <SettingRow
          icon={Sparkles}
          title="Condensed navigation"
          description="Hides unfinished payroll screens from the sidebar. Reloads the page."
          control={<ToggleInput checked={condensedNav} onChange={toggleCondensedNav} />}
        />
      </SettingsCard>

      <SettingsCard title="Environment">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Mode</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{import.meta.env.DEV ? 'development' : 'production'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Payroll flag</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">
              {import.meta.env.VITE_PAYROLL_ENABLED?.toString() || 'false'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Condensed navigation</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{condensedNav ? 'Enabled' : 'Disabled'}</dd>
          </div>
        </dl>
      </SettingsCard>
    </div>
  );
}
