import { useMemo, useState } from 'react';
import { FolderKanban, Search } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { buildSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { InviteOption } from '@/services/addUser';
import { PageEmptyState } from '@/components/ui/PageState';

interface ProjectMultiSelectProps {
  options: InviteOption[];
  selectedIds: number[];
  onChange: (selectedIds: number[]) => void;
  isLoading?: boolean;
  errorMessage?: string;
}

export default function ProjectMultiSelect({
  options,
  selectedIds,
  onChange,
  isLoading = false,
  errorMessage,
}: ProjectMultiSelectProps) {
  const [query, setQuery] = useState('');
  const [selectedSearchProjectId, setSelectedSearchProjectId] = useState<number | null>(null);
  const projectSearchSuggestions = useMemo(
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
        if (selectedSearchProjectId) {
          return Number(option.id) === Number(selectedSearchProjectId);
        }

        return matchesSearchFilter(query, [option.name, option.description, option.isDefault ? 'default' : 'custom']);
      }),
    [options, query, selectedSearchProjectId]
  );

  return (
    <div>
      <FieldLabel hint={`${selectedIds.length} selected`}>Projects they can access</FieldLabel>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SearchSuggestInput
          value={query}
          onValueChange={(value) => {
            setQuery(value);

            const selectedProjectName = options.find((option) => Number(option.id) === Number(selectedSearchProjectId))?.name || '';
            if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedProjectName)) {
              setSelectedSearchProjectId(null);
            }
          }}
          onSuggestionSelect={(suggestion) => {
            const nextProjectId = Number((suggestion.payload as InviteOption | undefined)?.id || suggestion.id || 0);
            setQuery(getSuggestionDisplayValue(suggestion));
            setSelectedSearchProjectId(Number.isFinite(nextProjectId) && nextProjectId > 0 ? nextProjectId : null);
          }}
          suggestions={projectSearchSuggestions}
          placeholder="Search projects"
          className="border-slate-200 bg-slate-50 shadow-none focus:bg-white"
          icon={<Search className="h-4 w-4" />}
          emptyMessage="No projects match this search."
        />
        {isLoading ? <p className="mt-3 text-sm text-slate-500">Loading available projects...</p> : null}
        {errorMessage ? <p className="mt-3 text-sm text-rose-600">{errorMessage}</p> : null}
        {!isLoading && !errorMessage && filteredOptions.length === 0 ? (
          <div className="mt-4">
            <PageEmptyState
              title={query.trim() ? 'No projects match this search' : 'No projects available'}
              description={query.trim() ? 'Try another project name or clear the search to view all projects.' : 'Project data is connected; assignment remains mock-ready until backend access control is added.'}
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
                      <FolderKanban className="h-4 w-4 text-slate-400" />
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
      <p className="mt-2 text-xs text-slate-500">Projects are loaded from the existing backend. Assignment permissions are staged for future API support.</p>
    </div>
  );
}
