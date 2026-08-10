import { Bell, CalendarDays, CheckSquare, FolderKanban, Mail, MessageSquare, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ToggleInput } from '@/components/ui/FormField';
import SettingsCard from '../components/SettingsCard';
import SettingRow from '../components/SettingRow';
import type { NotificationKey } from '../types';
import type { SettingsController } from '../useSettingsController';

const CHANNELS: Array<{ key: NotificationKey; icon: LucideIcon; title: string; description: string }> = [
  { key: 'email', icon: Mail, title: 'Email', description: 'Approvals, payslips and anything that needs a record.' },
  { key: 'in_app', icon: Bell, title: 'In-app', description: 'The bell in the top bar.' },
  { key: 'desktop_push', icon: Monitor, title: 'Desktop popup', description: 'Needs the CareVance desktop tracker running.' },
];

const TOPICS: Array<{ key: NotificationKey; icon: LucideIcon; title: string; description: string }> = [
  { key: 'chat_messages', icon: MessageSquare, title: 'Chat messages', description: 'Direct messages and mentions in channels.' },
  { key: 'weekly_summary', icon: CalendarDays, title: 'Weekly summary', description: 'Your hours, tasks and leave balance, every Monday.' },
  { key: 'project_updates', icon: FolderKanban, title: 'Project updates', description: 'When a project you are on changes status or owner.' },
  { key: 'task_assignments', icon: CheckSquare, title: 'Task assignments', description: 'When someone assigns you work or changes a due date.' },
];

export default function NotificationsPane({ controller }: { controller: SettingsController }) {
  const { notifications, setNotification, savingNotification, savedNotification } = controller;

  const enabledCount = Object.values(notifications).filter(Boolean).length;
  const total = Object.keys(notifications).length;

  const renderRow = (item: { key: NotificationKey; icon: LucideIcon; title: string; description: string }) => (
    <SettingRow
      key={item.key}
      icon={item.icon}
      title={item.title}
      description={item.description}
      control={
        <>
          <span
            aria-live="polite"
            className={`text-xs font-semibold text-emerald-700 transition-opacity ${
              savedNotification === item.key ? 'opacity-100' : 'opacity-0'
            }`}
          >
            Saved
          </span>
          <ToggleInput
            checked={notifications[item.key]}
            onChange={(checked) => void setNotification(item.key, checked)}
            disabled={savingNotification !== null}
          />
        </>
      }
    />
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        You will get <span className="font-semibold text-slate-900">{enabledCount} of the {total}</span> kinds of update
        CareVance sends. Changes here save straight away.
      </p>

      <SettingsCard
        title="How we reach you"
        description="Turn a channel off and nothing at all arrives that way."
      >
        {CHANNELS.map(renderRow)}
      </SettingsCard>

      <SettingsCard title="What we tell you about">
        {TOPICS.map(renderRow)}
      </SettingsCard>
    </div>
  );
}
