import { UserPlus, Users } from 'lucide-react';

interface ChatHeaderProps {
  onNewConversation: () => void;
  onCreateGroup: () => void;
}

export default function ChatHeader({ onNewConversation, onCreateGroup }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold text-gray-900">Messages</h1>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNewConversation}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="New conversation"
        >
          <UserPlus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onCreateGroup}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Create group"
        >
          <Users className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
