import ThreadItem from './ThreadItem';
import type { ChatConversation, ChatGroup } from '@/types';

interface ThreadListProps {
  threads: (ChatConversation | ChatGroup)[];
  selectedThreadId: number | null;
  onSelect: (id: number) => void;
  emptyMessage?: string;
}

export default function ThreadList({ threads, selectedThreadId, onSelect, emptyMessage = 'No conversations yet' }: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">{emptyMessage}</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          isSelected={selectedThreadId === thread.id}
          onSelect={() => onSelect(thread.id)}
        />
      ))}
    </div>
  );
}
