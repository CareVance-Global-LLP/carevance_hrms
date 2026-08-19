import { useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, Monitor } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess, resolveUserRoleLabel } from '@/lib/permissions';
import SettingsCard from '../components/SettingsCard';
import SettingRow from '../components/SettingRow';
import PasswordStrength, { evaluatePassword } from '../components/PasswordStrength';
import TwoFactorSection from '../components/TwoFactorSection';
import BreakGlassSection from '../components/BreakGlassSection';
import type { SettingsController } from '../useSettingsController';

/** Best-effort read of the current browser. Nothing here is invented — if the
 *  user agent does not say, the row does not claim. */
const describeBrowser = (): string => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const platform = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'This browser';
};

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <TextInput
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint}
    </div>
  );
}

export default function SecurityPane({ controller }: { controller: SettingsController }) {
  const {
    user,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    updatePassword,
    isSavingPassword,
  } = controller;
  const { logout } = useAuth();

  const { score } = useMemo(() => evaluatePassword(newPassword), [newPassword]);
  const matches = confirmPassword.length > 0 && confirmPassword === newPassword;
  const canSubmit = Boolean(currentPassword) && score === 4 && matches && !isSavingPassword;

  return (
    <div className="space-y-4">
      {/*
        First, above the password. A second factor is the control that survives
        the password being wrong, and burying it under the thing it protects
        against gets the ordering backwards.
      */}
      <TwoFactorSection />

      {/* Only an admin can allow or end support access, so only an admin is
          shown the controls. */}
      {hasAdminAccess(user) && <BreakGlassSection />}

      <SettingsCard title="Change password" description="Eight characters or more, with a mix of cases, a number and a symbol.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PasswordField
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Your password today"
            autoComplete="current-password"
          />
          <div className="hidden md:block" />
          <PasswordField
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Type it again"
            autoComplete="new-password"
            hint={
              confirmPassword ? (
                <p className={`mt-1.5 text-xs font-medium ${matches ? 'text-emerald-700' : 'text-red-600'}`}>
                  {matches ? 'Passwords match' : 'These do not match yet'}
                </p>
              ) : null
            }
          />
        </div>

        <PasswordStrength value={newPassword} />

        <div className="mt-5">
          <Button onClick={updatePassword} disabled={!canSubmit} loading={isSavingPassword}>
            Update password
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="This session" description="What the app can actually tell you about how you are signed in.">
        <SettingRow
          icon={Monitor}
          title={describeBrowser()}
          description="The browser you are reading this in."
          control={<StatusBadge tone="success">This device</StatusBadge>}
        />
        <SettingRow
          icon={Lock}
          title={`Signed in as ${resolveUserRoleLabel(user)}`}
          description={user?.email || undefined}
          control={
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          }
        />
      </SettingsCard>
    </div>
  );
}
