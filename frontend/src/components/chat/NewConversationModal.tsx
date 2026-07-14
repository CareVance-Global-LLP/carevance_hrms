import { useEffect, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { useAuth } from '@/contexts/AuthContext';
import { buildEmployeeSearchSuggestions, getSuggestionDisplayValue, normalizeSearchValue, rankSearchSuggestions } from '@/lib/searchSuggestions';
import { chatApi } from '@/services/api';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationCreated: (threadId: number) => void;
  availableUsers: Array<{ id: number; name: string; email: string; role: string }>;
}

export default function NewConversationModal({
  isOpen,
  onClose,
  onConversationCreated,
  availableUsers,
}: NewConversationModalProps) {
  const { user } = useAuth();
  const [startEmail, setStartEmail] = useState('');
  const [selectedStartUserId, setSelectedStartUserId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStartEmail('');
      setSelectedStartUserId(null);
      setError('');
    }
  }, [isOpen]);

  const selectedStartUser = availableUsers.find((c) => Number(c.id) === Number(selectedStartUserId)) || null;
  const availableUserSuggestions = buildEmployeeSearchSuggestions(availableUsers);

  const openDirectConversation = async (email: string) => {
    setError('');
    const nextEmail = email.trim();
    if (!nextEmail) return;

    try {
      setIsStarting(true);
      const response = await chatApi.startConversation(nextEmail);
      const created = response.data;
      setStartEmail('');
      setSelectedStartUserId(null);
      if (created?.id) {
        onConversationCreated(created.id);
        onClose();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not start conversation');
    } finally {
      setIsStarting(false);
    }
  };

  const startConversationFromDraft = async () => {
    const typedValue = startEmail.trim();
    if (!typedValue) return;

    const normalizedTypedValue = normalizeSearchValue(typedValue);
    const rankedMatches = rankSearchSuggestions(availableUserSuggestions, typedValue, 2);
    const singleSuggestedUser = rankedMatches.length === 1
      ? availableUsers.find((c) => Number(c.id) === Number(rankedMatches[0].id)) || null
      : null;
    const matchedUser =
      selectedStartUser ||
      availableUsers.find((c) => (
        normalizeSearchValue(c.name) === normalizedTypedValue ||
        normalizeSearchValue(c.email) === normalizedTypedValue
      )) ||
      singleSuggestedUser ||
      null;

    await openDirectConversation(matchedUser?.email?.trim() || typedValue);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startConversationFromDraft();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary-600" />
            New Conversation
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Search teammate by name or enter email
            </label>
            <SearchSuggestInput
              type="text"
              value={startEmail}
              onValueChange={(value) => {
                setStartEmail(value);
                if (!selectedStartUser) return;
                const normalizedValue = normalizeSearchValue(value);
                if (
                  normalizedValue !== normalizeSearchValue(selectedStartUser.name) &&
                  normalizedValue !== normalizeSearchValue(selectedStartUser.email)
                ) {
                  setSelectedStartUserId(null);
                }
              }}
              onSuggestionSelect={(suggestion) => {
                const nextUserId = Number((suggestion.payload as { id?: number } | undefined)?.id || suggestion.id || 0);
                const nextUser = availableUsers.find((c) => Number(c.id) === nextUserId) || null;
                setStartEmail(getSuggestionDisplayValue(suggestion));
                setSelectedStartUserId(Number.isFinite(nextUserId) && nextUserId > 0 ? nextUserId : null);
                if (nextUser?.email) {
                  void openDirectConversation(nextUser.email);
                }
              }}
              onCommit={() => void startConversationFromDraft()}
              suggestions={availableUserSuggestions}
              placeholder="Search teammate by name or enter email"
              emptyMessage="No teammate names match this search."
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!startEmail.trim() || isStarting}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isStarting ? 'Starting...' : 'Start / Open Chat'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
