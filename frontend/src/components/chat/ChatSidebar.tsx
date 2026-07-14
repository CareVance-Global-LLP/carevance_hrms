import { useState } from 'react';
import ChatHeader from './ChatHeader';
import ChatSearchBar from './ChatSearchBar';
import ChatTabs, { type ChatTab } from './ChatTabs';
import ThreadList from './ThreadList';
import type { ChatConversation, ChatGroup } from '@/types';

interface ChatSidebarProps {
  conversations: ChatConversation[];
  groups: ChatGroup[];
  selectedThread: { type: 'direct' | 'group'; id: number } | null;
  onSelectThread: (type: 'direct' | 'group', id: number) => void;
  onNewConversation: () => void;
  onCreateGroup: () => void;
}

export default function ChatSidebar({
  conversations,
  groups,
  selectedThread,
  onSelectThread,
  onNewConversation,
  onCreateGroup,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<ChatTab>('chats');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      c.other_user?.name?.toLowerCase().includes(query) ||
      c.other_user?.email?.toLowerCase().includes(query) ||
      c.last_message?.body?.toLowerCase().includes(query)
    );
  });

  const filteredGroups = groups.filter((g) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      g.name?.toLowerCase().includes(query) ||
      g.last_message?.body?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-white">
      <div className="p-4">
        <ChatHeader onNewConversation={onNewConversation} onCreateGroup={onCreateGroup} />
      </div>
      <div className="px-4 pb-3">
        <ChatSearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>
      <ChatTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'chats' ? (
          <ThreadList
            threads={filteredConversations}
            selectedThreadId={selectedThread?.type === 'direct' ? selectedThread.id : null}
            onSelect={(id) => onSelectThread('direct', id)}
            emptyMessage="No conversations yet"
          />
        ) : (
          <ThreadList
            threads={filteredGroups}
            selectedThreadId={selectedThread?.type === 'group' ? selectedThread.id : null}
            onSelect={(id) => onSelectThread('group', id)}
            emptyMessage="No groups yet"
          />
        )}
      </div>
    </div>
  );
}
