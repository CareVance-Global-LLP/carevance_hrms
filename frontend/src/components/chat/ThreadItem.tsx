import { decodeHtmlEntities } from '@/lib/formatters';
import type { ChatConversation, ChatGroup } from '@/types';

interface ThreadItemProps {
  thread: ChatConversation | ChatGroup;
  isSelected: boolean;
  onSelect: () => void;
}

export default function ThreadItem({ thread, isSelected, onSelect }: ThreadItemProps) {
  const isGroup = 'name' in thread && !('other_user' in thread);
  const conversation = thread as ChatConversation;
  const group = thread as ChatGroup;

  const name = isGroup ? group.name : conversation.other_user?.name || 'Unknown';
  const lastMessage = isGroup ? group.last_message?.body : conversation.last_message?.body;
  const unreadCount = thread.unread_count || 0;
  const isOnline = !isGroup && conversation.other_user?.is_online;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        isSelected
          ? 'bg-primary-50'
          : 'hover:bg-gray-50'
      }`}
    >
      <div className="relative h-10 w-10 shrink-0">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white ${
          isGroup ? 'bg-primary-100 text-primary-700' : 'bg-primary-600'
        }`}>
          {isGroup ? (
            <span className="text-lg">{group.name.charAt(0).toUpperCase()}</span>
          ) : (
            <span>{name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        {!isGroup && (
          <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
            isOnline ? 'bg-green-500' : 'bg-gray-300'
          }`} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-gray-900">{name}</p>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {lastMessage && (
          <p className="truncate text-xs text-gray-500">{decodeHtmlEntities(lastMessage)}</p>
        )}
      </div>
    </button>
  );
}
