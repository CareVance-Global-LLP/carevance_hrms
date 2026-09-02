import { useState } from 'react';
import { Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import { monitoringConsentApi } from '@/services/api';
import SettingsCard from './SettingsCard';
import { brandLabel } from '@/config/brand';

const CAPTURE_TYPES = ['screenshot', 'activity', 'location', 'selfie'] as const;

const LABELS: Record<string, string> = {
  screenshot: 'Screen images',
  activity: 'Apps and websites',
  location: 'Location at clock-in',
  selfie: 'Photo at clock-in',
};

const DEFAULT_PURPOSES: Record<string, string> = {
  screenshot: 'Periodic screen captures during tracked working time, to verify billable work.',
  activity: 'Application and website names during tracked working time, to measure productive time.',
  location: 'Location at the moment of clocking in or out, to confirm attendance at an assigned site.',
  selfie: 'A photograph at the moment of clocking in, to confirm the person present is the employee.',
};

const DEFAULT_BODY =
  `While you are clocked in, ${brandLabel} records what is listed below so that work can be verified and attendance confirmed. `
  + 'Nothing is collected outside tracked working time. You can choose what you agree to, and you can withdraw at any time.';

/**
 * Publishing the notice employees are asked to agree to.
 *
 * Everything on this form maps to something the DPDP Rules require of a
 * consent notice: an itemised description with a purpose per item, a retention
 * period, and a named contact for grievances. It is prefilled with sensible
 * wording rather than left blank — a required legal text nobody writes is a
 * blank textarea that blocks the feature forever.
 *
 * Publishing supersedes rather than edits. Consent already given is recorded
 * against the version it was given to, so new wording asks again instead of
 * inheriting an answer to different words.
 */
export default function PublishMonitoringNotice({
  currentVersion,
  onPublished,
}: {
  currentVersion: number | null;
  onPublished: () => void;
}) {
  const { show } = useToast();
  const [open, setOpen] = useState(currentVersion === null);
  const [busy, setBusy] = useState(false);

  const [body, setBody] = useState(DEFAULT_BODY);
  const [purposes, setPurposes] = useState<Record<string, string>>({ ...DEFAULT_PURPOSES });
  const [retentionDays, setRetentionDays] = useState('90');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const publish = async () => {
    setBusy(true);
    try {
      await monitoringConsentApi.publishNotice({
        body,
        purposes,
        retention_days: Number(retentionDays),
        grievance_contact_name: contactName,
        grievance_contact_email: contactEmail,
      });
      show({
        kind: 'success',
        message: 'Notice published. Everyone will be asked to agree to this version.',
      });
      setOpen(false);
      onPublished();
    } catch (error: any) {
      show({
        kind: 'error',
        message: error?.response?.data?.message || 'Could not publish that notice.',
      });
    } finally {
      setBusy(false);
    }
  };

  const canPublish =
    body.trim().length >= 40
    && contactName.trim().length > 0
    && contactEmail.trim().length > 0
    && Number(retentionDays) > 0;

  return (
    <SettingsCard
      title={currentVersion === null ? 'Publish a monitoring notice' : 'Publish a new version'}
      description={
        currentVersion === null
          ? 'Employees cannot agree to anything until this exists. Until it does, capture continues under your grace policy but nobody has consented to it.'
          : `Version ${currentVersion} is live. Publishing again supersedes it, and everyone is asked to agree to the new wording.`
      }
      aside={
        !open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Write a new version
          </Button>
        ) : null
      }
    >
      {!open ? null : (
        <div className="space-y-4">
          <div>
            <FieldLabel htmlFor="notice-body">What employees will read</FieldLabel>
            <textarea
              id="notice-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border-strong bg-surface-card px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-300/30"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700">Why each kind of data is collected</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Each purpose is shown next to its own switch, so people agree to them one at a time.
            </p>
            <div className="mt-2 space-y-2">
              {CAPTURE_TYPES.map((type) => (
                <div key={type}>
                  <FieldLabel htmlFor={`purpose-${type}`}>{LABELS[type]}</FieldLabel>
                  <TextInput
                    id={`purpose-${type}`}
                    value={purposes[type] ?? ''}
                    onChange={(event) =>
                      setPurposes((current) => ({ ...current, [type]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <FieldLabel htmlFor="notice-retention">Kept for (days)</FieldLabel>
              <TextInput
                id="notice-retention"
                type="number"
                min={1}
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="notice-contact-name">Grievance contact</FieldLabel>
              <TextInput
                id="notice-contact-name"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Name and role"
              />
            </div>
            <div>
              <FieldLabel htmlFor="notice-contact-email">Their email</FieldLabel>
              <TextInput
                id="notice-contact-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="privacy@yourcompany.com"
              />
            </div>
          </div>

          {/* Required, and stated as such: a notice that lists purposes but
              names nobody to object to is a disclosure, not consent. */}
          <p className="text-xs text-slate-500">
            A contact is required. Employees are also told they may take a complaint to the Data
            Protection Board of India.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void publish()} disabled={busy || !canPublish} loading={busy}>
              <Send className="h-3.5 w-3.5" />
              Publish notice
            </Button>
            {currentVersion !== null && (
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
