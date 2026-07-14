import { useEffect, useState } from 'react';
import { X, Users } from 'lucide-react';
import { chatApi } from '@/services/api';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated: (groupId: number) => void;
  availableUsers: Array<{ id: number; name: string; email: string; role: string }>;
}

export default function CreateGroupModal({
  isOpen,
  onClose,
  onGroupCreated,
  availableUsers,
}: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setGroupName('');
      setGroupMemberIds([]);
      setError('');
    }
  }, [isOpen]);

  const toggleMember = (userId: number) => {
    setGroupMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!groupName.trim() || groupMemberIds.length === 0) {
      setError('Group name and at least one member are required.');
      return;
    }

    try {
      setIsCreating(true);
      const response = await chatApi.createGroup({
        name: groupName.trim(),
        user_ids: groupMemberIds,
      });
      setGroupName('');
      setGroupMemberIds([]);
      if (response.data?.id) {
        onGroupCreated(response.data.id);
        onClose();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create group');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-600" />
            Create Group Chat
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Select Members
              </label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {availableUsers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">No teammates available.</p>
                ) : (
                  availableUsers.map((candidate) => (
                    <label
                      key={candidate.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                        groupMemberIds.includes(candidate.id)
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={groupMemberIds.includes(candidate.id)}
                        onChange={() => toggleMember(candidate.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{candidate.name}</p>
                        <p className="text-xs text-gray-500 truncate">{candidate.email}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
              {groupMemberIds.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">{groupMemberIds.length} member(s) selected</p>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-200 p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!groupName.trim() || groupMemberIds.length === 0 || isCreating}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
