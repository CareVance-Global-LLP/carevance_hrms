import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { buildSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { InviteOption } from '@/services/addUser';
import { PageEmptyState } from '@/components/ui/PageState';
import Button from '@/components/ui/Button';

interface GroupMultiSelectProps {
  options: InviteOption[];
  selectedIds: number[];
  onChange: (selectedIds: number[]) => void;
  isLoading?: boolean;
  errorMessage?: string;
  onCreateNew?: () => void;
}

export default function GroupMultiSelect({
  options,
  selectedIds,
  onChange,
  isLoading = false,
  errorMessage,
  onCreateNew,
}: GroupMultiSelectProps) {
  const [query, setQuery] = useState('');
  const [selectedSearchGroupId, setSelectedSearchGroupId] = useState<number | null>(null);
  const groupSearchSuggestions = useMemo(
    () =>
      buildSearchSuggestions(options, (option) => ({
        id: option.id,
        label: option.name,
        description: option.description,
        keywords: [option.isDefault ? 'default' : 'custom'],
        payload: option,
      })),
    [options]
  );

  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (selectedSearchGroupId) {
          return Number(option.id) === Number(selectedSearchGroupId);
        }

        return matchesSearchFilter(query, [option.name, option.description, option.isDefault ? 'default' : 'custom']);
      }),
    [options, query, selectedSearchGroupId]
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <FieldLabel hint={`${selectedIds.length} selected`}>Groups they&apos;re members of</FieldLabel>
        {onCreateNew ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCreateNew}>
            + Create new group
          </Button>
        ) : null}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SearchSuggestInput
          value={query}
          onValueChange={(value) => {
            setQuery(value);

            const selectedGroupName = options.find((option) => Number(option.id) === Number(selectedSearchGroupId))?.name || '';
            if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedGroupName)) {
              setSelectedSearchGroupId(null);
            }
          }}
          onSuggestionSelect={(suggestion) => {
            const nextGroupId = Number((suggestion.payload as InviteOption | undefined)?.id || suggestion.id || 0);
            setQuery(getSuggestionDisplayValue(suggestion));
            setSelectedSearchGroupId(Number.isFinite(nextGroupId) && nextGroupId > 0 ? nextGroupId : null);
          }}
          suggestions={groupSearchSuggestions}
          placeholder="Search groups"
          className="border-slate-200 bg-slate-50 shadow-none focus:bg-white"
          icon={<Search className="h-4 w-4" />}
          emptyMessage="No groups match this search."
        />
        {isLoading ? <p className="mt-3 text-sm text-slate-500">Loading available groups...</p> : null}
        {errorMessage ? <p className="mt-3 text-sm text-rose-600">{errorMessage}</p> : null}
        {!isLoading && !errorMessage && filteredOptions.length === 0 ? (
          <div className="mt-4">
            <PageEmptyState
              title={query.trim() ? 'No groups match this search' : 'No groups available'}
              description={query.trim() ? 'Try another group name or clear the search to view all groups.' : 'Report groups can be added later; this selector is ready for existing teams.'}
            />
          </div>
        ) : (
          <div className="mt-4 max-h-52 space-y-2 overflow-auto pr-1">
            {filteredOptions.map((option) => {
              const checked = selectedIds.includes(option.id);

              return (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                    checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selectedIds, option.id]
                          : selectedIds.filter((id) => id !== option.id)
                      )
                    }
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      <p className="text-sm font-semibold text-slate-950">{option.name}</p>
                      {option.isDefault ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{option.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
