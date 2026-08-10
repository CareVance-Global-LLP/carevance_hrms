import { Link2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput, TextareaInput, ToggleInput } from '@/components/ui/FormField';
import SettingsCard from '../components/SettingsCard';
import SettingRow from '../components/SettingRow';
import SegmentedControl from '../components/SegmentedControl';
import { helpIssueCategories, type HelpIssueCategory } from '../useSettingsController';
import type { SettingsController } from '../useSettingsController';

const MAX_DESCRIPTION = 4000;

export default function HelpPane({ controller }: { controller: SettingsController }) {
  const {
    helpName,
    setHelpName,
    helpEmail,
    setHelpEmail,
    helpIssueCategory,
    setHelpIssueCategory,
    helpSummary,
    setHelpSummary,
    helpDescription,
    setHelpDescription,
    helpAttachContext,
    setHelpAttachContext,
    submitHelpTicket,
    isSubmittingHelp,
  } = controller;

  const canSubmit = Boolean(helpEmail.trim() && helpSummary.trim() && helpDescription.trim());

  return (
    <SettingsCard
      title="Tell us what went wrong"
      description="It lands in the support inbox. We usually reply within one working day."
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>What kind of problem is it?</FieldLabel>
          <SegmentedControl
            size="sm"
            ariaLabel="Issue category"
            value={helpIssueCategory}
            onChange={(value) => setHelpIssueCategory(value as HelpIssueCategory)}
            options={helpIssueCategories.map((category) => ({ value: category.value, label: category.label }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Your name</FieldLabel>
            <TextInput value={helpName} onChange={(event) => setHelpName(event.target.value)} placeholder="Your name" />
          </div>
          <div>
            <FieldLabel>Reply to</FieldLabel>
            <TextInput
              type="email"
              value={helpEmail}
              onChange={(event) => setHelpEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </div>
        </div>

        <div>
          <FieldLabel>In one line</FieldLabel>
          <TextInput
            value={helpSummary}
            onChange={(event) => setHelpSummary(event.target.value)}
            placeholder="Payslip download returns an empty PDF"
            maxLength={255}
          />
        </div>

        <div>
          <FieldLabel>What happened</FieldLabel>
          <TextareaInput
            value={helpDescription}
            onChange={(event) => setHelpDescription(event.target.value)}
            placeholder="What you did, what you expected, and what happened instead."
            rows={6}
            maxLength={MAX_DESCRIPTION}
          />
          <p className="mt-1 text-right text-xs tabular-nums text-slate-600">
            {helpDescription.length} / {MAX_DESCRIPTION}
          </p>
        </div>

        <SettingRow
          icon={Link2}
          title="Attach where you were"
          description="Sends the page you are on so support can reproduce it. No screenshots, no personal data."
          control={<ToggleInput checked={helpAttachContext} onChange={setHelpAttachContext} />}
        />

        <Button onClick={submitHelpTicket} disabled={!canSubmit || isSubmittingHelp} loading={isSubmittingHelp}>
          Send to support
        </Button>
      </div>
    </SettingsCard>
  );
}
