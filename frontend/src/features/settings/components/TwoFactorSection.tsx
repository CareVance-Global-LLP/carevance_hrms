import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import QRCode from 'qrcode';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import OneTimeCodeInput from '@/components/auth/OneTimeCodeInput';
import { useToast } from '@/components/ui/Toast';
import { authApi, type MfaStatus } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from './SettingsCard';
import SettingRow from './SettingRow';
import RecoveryCodes from './RecoveryCodes';
import { brandLabel } from '@/config/brand';

type Stage = 'idle' | 'scanning' | 'showing-codes' | 'disabling' | 'regenerating';

/** Human-readable deadline, or null when there is nothing to state. */
const formatDeadline = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * Two-factor authentication for the signed-in user's own account.
 *
 * Everything shown here is read from the server at render — the enrolment
 * state, whether this role is obliged to have it, the organisation's policy
 * and the real deadline. Nothing is inferred from the user object, because a
 * badge that claims a policy the server does not hold is worse than no badge.
 */
export default function TwoFactorSection() {
  const { show } = useToast();

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);

  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await authApi.mfaStatus();
      if (mounted.current) setStatus(next);
    } catch (err) {
      reportSilentError('settings.mfa.status', err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetFlow = () => {
    setStage('idle');
    setSecret('');
    setQrDataUrl('');
    setCode('');
    setPassword('');
    setError(null);
  };

  const beginSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const { secret: nextSecret, otpauth_url: uri } = await authApi.mfaBeginSetup();
      // Rendered locally: the otpauth URI contains the shared secret, and
      // handing it to a third-party QR service would hand over the credential.
      const dataUrl = await QRCode.toDataURL(uri, { width: 220, margin: 1 });
      if (!mounted.current) return;
      setSecret(nextSecret);
      setQrDataUrl(dataUrl);
      setStage('scanning');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not start setup. Please try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const codes = await authApi.mfaConfirmSetup(code);
      if (!mounted.current) return;
      setRecoveryCodes(codes);
      setStage('showing-codes');
      setCode('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'That code was not accepted. Try the next one.');
      setCode('');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const codes = await authApi.mfaRegenerateRecoveryCodes(password);
      if (!mounted.current) return;
      setRecoveryCodes(codes);
      setStage('showing-codes');
      setPassword('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not issue new codes.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.mfaDisable({ password, code });
      if (!mounted.current) return;
      show({ kind: 'success', message: 'Two-factor authentication is off. You have been signed out everywhere else.' });
      resetFlow();
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not switch it off.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (loading) {
    return (
      <SettingsCard title="Two-factor authentication">
        <p className="text-xs text-slate-500">Checking…</p>
      </SettingsCard>
    );
  }

  if (!status) {
    return null;
  }

  const deadline = formatDeadline(status.grace_ends_at);

  return (
    <SettingsCard
      title="Two-factor authentication"
      description="A code from an authenticator app, in addition to your password. It is what stops a leaked password from being enough on its own."
      aside={
        status.enrolled
          ? <StatusBadge tone="success">On</StatusBadge>
          : <StatusBadge tone={status.required ? 'danger' : 'neutral'}>Off</StatusBadge>
      }
    >
      {/*
        The obligation, stated with the real date from the server rather than a
        generic warning. Someone told "this will be required" without being told
        when has been given a worry, not an instruction.
      */}
      {!status.enrolled && status.privileged && status.policy !== 'off' && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-5 text-amber-900">
            {status.policy === 'enforced'
              ? `Your organisation requires two-factor authentication for your role. Set it up now to keep using ${brandLabel}.`
              : deadline
                ? `Your organisation will require this for your role from ${deadline}. After that you will not be able to sign in without it.`
                : 'Your organisation will require this for your role shortly.'}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      {stage === 'showing-codes' && (
        <div className="mb-4">
          <RecoveryCodes
            codes={recoveryCodes}
            onDone={() => {
              setRecoveryCodes([]);
              resetFlow();
            }}
          />
        </div>
      )}

      {stage === 'scanning' && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-surface-sunken p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="QR code for setting up two-factor authentication"
                className="h-[220px] w-[220px] shrink-0 self-center rounded-md border border-slate-200 bg-white p-2"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Scan this in your authenticator app</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Google Authenticator, 1Password, Authy, Microsoft Authenticator — any of them work.
              </p>

              <p className="mt-3 text-xs text-slate-600">Can&rsquo;t scan? Enter this key by hand:</p>
              <code className="mt-1 block break-all rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-800">
                {secret}
              </code>

              <div className="mt-4">
                <FieldLabel htmlFor="mfa-setup-code">Enter the 6-digit code it shows</FieldLabel>
                <OneTimeCodeInput
                  id="mfa-setup-code"
                  value={code}
                  onChange={setCode}
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void confirmSetup()} disabled={busy || code.length < 6} loading={busy}>
                  Turn on
                </Button>
                <Button variant="secondary" onClick={resetFlow} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === 'regenerating' && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-surface-sunken p-4">
          <p className="text-sm font-medium text-slate-900">Issue new recovery codes</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Your previous codes stop working immediately. Confirm your password to continue.
          </p>
          <div className="mt-3 max-w-sm">
            <FieldLabel htmlFor="mfa-regen-password">Password</FieldLabel>
            <TextInput
              id="mfa-regen-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void regenerate()} disabled={busy || !password} loading={busy}>
              Issue new codes
            </Button>
            <Button variant="secondary" onClick={resetFlow} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {stage === 'disabling' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">Switch off two-factor authentication</p>
          <p className="mt-1 text-xs leading-5 text-red-800">
            Both your password and a current code are needed. A stolen session alone must not be able
            to remove the thing that protects against exactly that.
          </p>
          <div className="mt-3 grid max-w-lg gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="mfa-off-password">Password</FieldLabel>
              <TextInput
                id="mfa-off-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="mfa-off-code">Code</FieldLabel>
              <OneTimeCodeInput id="mfa-off-code" value={code} onChange={setCode} allowRecoveryCode disabled={busy} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void disable()} disabled={busy || !password || !code} loading={busy}>
              Switch it off
            </Button>
            <Button variant="secondary" onClick={resetFlow} disabled={busy}>
              Keep it on
            </Button>
          </div>
        </div>
      )}

      {stage === 'idle' && (
        <>
          <SettingRow
            icon={status.enrolled ? ShieldCheck : ShieldOff}
            title={status.enrolled ? 'Authenticator app' : 'No second factor yet'}
            description={
              status.enrolled
                ? 'You will be asked for a code each time you sign in.'
                : 'Your password is currently the only thing protecting this account.'
            }
            control={
              status.enrolled ? (
                <Button variant="secondary" size="sm" onClick={() => setStage('disabling')}>
                  Turn off
                </Button>
              ) : (
                <Button size="sm" onClick={() => void beginSetup()} loading={busy}>
                  Set up
                </Button>
              )
            }
          />

          {status.enrolled && (
            <SettingRow
              icon={KeyRound}
              title="Recovery codes"
              description={
                status.unused_recovery_codes > 0
                  ? `${status.unused_recovery_codes} unused ${status.unused_recovery_codes === 1 ? 'code' : 'codes'} left. These are how you get back in without your phone.`
                  : 'None left. Issue a new set now — without one you would be locked out if you lost your authenticator.'
              }
              control={
                <Button
                  variant={status.unused_recovery_codes === 0 ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setStage('regenerating')}
                >
                  Issue new codes
                </Button>
              }
            />
          )}
        </>
      )}
    </SettingsCard>
  );
}
