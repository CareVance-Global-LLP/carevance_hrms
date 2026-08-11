import { settingsApi } from '@/services/api';
import { useTheme, type ThemeChoice } from '@/contexts/ThemeContext';
import SettingsCard from '../components/SettingsCard';
import ThemeTile from '../components/ThemeTile';

const OPTIONS: Array<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'System', hint: 'Match my device' },
];

export default function AppearancePane() {
  const { choice, theme: resolvedTheme, setTheme } = useTheme();

  const select = (value: ThemeChoice) => {
    // Local storage applies instantly and covers logged-out pages; the account
    // copy just follows you to other devices.
    setTheme(value);
    settingsApi.updatePreferences({ theme: value }).catch(() => {
      // Non-fatal: the theme is already applied on this device.
    });
  };

  return (
    <SettingsCard
      title="Theme"
      description="Applies to this device immediately, and follows you to the others."
    >
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => (
          <ThemeTile
            key={option.value}
            value={option.value}
            label={option.label}
            hint={option.hint}
            selected={choice === option.value}
            onSelect={select}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-600">
        Currently showing the <span className="font-semibold text-slate-900">{resolvedTheme}</span> theme
        {choice === 'system' ? ', following your device setting.' : '.'}
      </p>
    </SettingsCard>
  );
}
