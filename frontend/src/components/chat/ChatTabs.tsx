export type ChatTab = 'chats' | 'groups';

interface ChatTabsProps {
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
}

export default function ChatTabs({ activeTab, onTabChange }: ChatTabsProps) {
  return (
    <div className="flex border-b border-gray-200">
      <button
        type="button"
        onClick={() => onTabChange('chats')}
        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
          activeTab === 'chats'
            ? 'border-b-2 border-primary-600 text-primary-600'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Chats
      </button>
      <button
        type="button"
        onClick={() => onTabChange('groups')}
        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
          activeTab === 'groups'
            ? 'border-b-2 border-primary-600 text-primary-600'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Groups
      </button>
    </div>
  );
}
