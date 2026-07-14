import { MessageSquare, Plus } from 'lucide-react';

interface ChatEmptyStateProps {
  onNewConversation: () => void;
}

export default function ChatEmptyState({ onNewConversation }: ChatEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
        <MessageSquare className="h-8 w-8 text-gray-400" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-gray-900">Select a conversation</h2>
      <p className="mb-6 max-w-sm text-sm text-gray-500">
        Choose a conversation from the left or start a new one to begin chatting
      </p>
      <button
        type="button"
        onClick={onNewConversation}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
      >
        <Plus className="h-4 w-4" />
        New Conversation
      </button>
    </div>
  );
}
