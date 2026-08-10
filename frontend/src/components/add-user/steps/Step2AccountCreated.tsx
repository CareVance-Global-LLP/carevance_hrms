import { useState } from 'react';
import { CheckCircle2, Mail, ExternalLink, Copy, Check, ShieldCheck } from 'lucide-react';
import type { AddUserWizardForm } from './types';

interface Step2Props {
  form: AddUserWizardForm;
}

export function Step2AccountCreated({ form }: Step2Props) {
  const [copied, setCopied] = useState(false);

  const loginUrl = `${window.location.origin}/login`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
      </div>

      <h3 className="text-xl font-semibold text-gray-900">Review Details</h3>

      {form.employeeCode && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-6 py-4">
          <p className="text-xs text-blue-600 font-medium uppercase tracking-wider mb-1">Employee Code</p>
          <p className="text-2xl font-bold text-blue-700 font-mono">{form.employeeCode}</p>
        </div>
      )}

      <div className="space-y-3 text-sm text-gray-600 w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center">
          <Mail className="h-4 w-4 text-gray-400" />
          <span>Setting up <strong className="text-gray-900">{form.email}</strong></span>
        </div>

        <div className="flex items-center gap-2 justify-center bg-gray-50 rounded-lg px-4 py-2">
          <ExternalLink className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-gray-600">Login:</span>
          <strong className="text-gray-900 truncate">{loginUrl}</strong>
          <button
            onClick={handleCopyLink}
            className="ml-auto p-1 hover:bg-gray-200 rounded transition shrink-0"
            title="Copy link"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 text-gray-400" />
            )}
          </button>
        </div>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-start gap-3 text-left max-w-sm">
        <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Account is created in the next step</p>
          <p className="text-xs text-emerald-700 mt-1">
            Continue to create the account for <strong>{form.email}</strong>. No email is sent on this
            path — you'll get their sign-in details at the end to pass on directly.
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-400 max-w-sm">
        You can complete their profile now or let them fill it later via self-service.
      </p>
    </div>
  );
}
