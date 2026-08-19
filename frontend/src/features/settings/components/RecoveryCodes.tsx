import { useState } from 'react';
import { Check, Copy, Download, KeyRound, ShieldAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * Recovery codes, shown the only time they can be.
 *
 * They are stored hashed, so this really is the one chance to keep them —
 * which makes "copy" and "download" load-bearing rather than conveniences. The
 * panel deliberately does not offer a way to dismiss it until the user has
 * taken a copy or explicitly confirmed they have.
 */
export default function RecoveryCodes({
  codes,
  onDone,
  title = 'Save your recovery codes',
}: {
  codes: string[];
  onDone: () => void;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const asText = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setSaved(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // A blocked clipboard is not a failure worth interrupting anyone over —
      // the codes are on screen and can be selected by hand.
      reportSilentError('settings.mfa.copyRecoveryCodes', error);
    }
  };

  const download = () => {
    try {
      const blob = new Blob(
        [
          'CareVance recovery codes\n',
          'Each code works once. Keep them somewhere you can reach without this device.\n\n',
          asText,
          '\n',
        ],
        { type: 'text/plain' },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'carevance-recovery-codes.txt';
      link.click();
      URL.revokeObjectURL(url);
      setSaved(true);
    } catch (error) {
      reportSilentError('settings.mfa.downloadRecoveryCodes', error);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{title}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            These are shown once and cannot be recovered. Each one works a single time, and they are
            the only way back in if you lose your authenticator app.
          </p>

          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-amber-200 bg-white p-3 font-mono text-xs text-slate-800 sm:grid-cols-2">
            {codes.map((code) => (
              <li key={code} className="tracking-wider">
                {code}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="secondary" size="sm" onClick={download}>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
            <Button size="sm" onClick={onDone} disabled={!saved}>
              <KeyRound className="h-3.5 w-3.5" />
              {saved ? "I've saved them" : 'Copy or download first'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
