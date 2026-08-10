import { useEffect, useState } from 'react';
import ChatHeader from './ChatHeader';
import ChatSearchBar from './ChatSearchBar';
import ChatTabs, { type ChatTab } from './ChatTabs';
import ThreadList from './ThreadList';
import MessageSearchResults from './MessageSearchResults';
import { chatApi } from '@/services/api';
import type { ChatConversation, ChatGroup, ChatMessageSearchHit } from '@/types';

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
  const [messageHits, setMessageHits] = useState<ChatMessageSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const trimmedQuery = searchQuery.trim();
  const isSearchMode = trimmedQuery.length >= 2;

  // Message search runs server-side against every thread the viewer belongs to.
  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (!isSearchMode) {
      setMessageHits([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timer = window.setTimeout(() => {
      chatApi
        .searchMessages(trimmedQuery)
        .then((response) => {
          if (!cancelled) setMessageHits(response.data?.data || []);
        })
        .catch(() => {
          if (!cancelled) setMessageHits([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery, isSearchMode]);

  const filteredConversations = conversations.filter((c) => {
    if (!trimmedQuery) return true;
    const query = trimmedQuery.toLowerCase();
    return (
      c.other_user?.name?.toLowerCase().includes(query) ||
      c.other_user?.email?.toLowerCase().includes(query) ||
      c.last_message?.body?.toLowerCase().includes(query)
    );
  });

  const filteredGroups = groups.filter((g) => {
    if (!trimmedQuery) return true;
    const query = trimmedQuery.toLowerCase();
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

      {isSearchMode ? (
        <div className="flex-1 overflow-y-auto p-2">
          {filteredConversations.length + filteredGroups.length > 0 ? (
            <div className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                Conversations · {filteredConversations.length + filteredGroups.length}
              </p>
              <ThreadList
                threads={filteredConversations}
                selectedThreadId={selectedThread?.type === 'direct' ? selectedThread.id : null}
                onSelect={(id) => onSelectThread('direct', id)}
                emptyMessage=""
              />
              <ThreadList
                threads={filteredGroups}
                selectedThreadId={selectedThread?.type === 'group' ? selectedThread.id : null}
                onSelect={(id) => onSelectThread('group', id)}
                emptyMessage=""
              />
            </div>
          ) : null}

          <MessageSearchResults
            term={trimmedQuery}
            results={messageHits}
            isSearching={isSearching}
            onSelect={(hit) => onSelectThread(hit.thread_type, hit.thread_id)}
          />
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
