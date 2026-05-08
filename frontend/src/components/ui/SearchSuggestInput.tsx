import { useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TextInput } from '@/components/ui/FormField';
import { rankSearchSuggestions, type SearchSuggestionOption } from '@/lib/searchSuggestions';
import { cn } from '@/utils/cn';
import useFloatingDropdown from '@/components/ui/useFloatingDropdown';

interface SearchSuggestInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: SearchSuggestionOption[];
  onSuggestionSelect?: (suggestion: SearchSuggestionOption) => void;
  onCommit?: (value: string) => void;
  maxSuggestions?: number;
  emptyMessage?: string;
  wrapperClassName?: string;
  icon?: ReactNode;
}

export default function SearchSuggestInput({
  value,
  onValueChange,
  suggestions,
  onSuggestionSelect,
  onCommit,
  maxSuggestions = 7,
  emptyMessage = 'No matching results found.',
  wrapperClassName,
  className,
  icon,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: SearchSuggestInputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const hasTypedQuery = value.trim().length > 0;
  const rankedSuggestions = useMemo(
    () => rankSearchSuggestions(suggestions, value, maxSuggestions),
    [maxSuggestions, suggestions, value]
  );
  const shouldShowSuggestions = isOpen && hasTypedQuery;
  const { panelRef, panelStyle } = useFloatingDropdown(inputRef, shouldShowSuggestions);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && panelRef.current
        && !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      } else if (containerRef.current && !containerRef.current.contains(target) && !panelRef.current) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!shouldShowSuggestions) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex(rankedSuggestions.length > 0 ? 0 : -1);
  }, [rankedSuggestions.length, shouldShowSuggestions]);

  const selectSuggestion = (suggestion: SearchSuggestionOption) => {
    onValueChange(suggestion.value || suggestion.label);
    onSuggestionSelect?.(suggestion);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className={cn('relative', wrapperClassName)} ref={containerRef}>
      {icon ? <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400">{icon}</div> : null}
      <TextInput
        {...props}
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          setIsOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          window.setTimeout(() => {
            if (
              containerRef.current
              && !containerRef.current.contains(document.activeElement)
              && panelRef.current
              && !panelRef.current.contains(document.activeElement)
            ) {
              setIsOpen(false);
              setActiveIndex(-1);
            } else if (containerRef.current && !containerRef.current.contains(document.activeElement) && !panelRef.current) {
              setIsOpen(false);
              setActiveIndex(-1);
            }
          }, 0);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (shouldShowSuggestions && rankedSuggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((current) => (current + 1) % rankedSuggestions.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((current) => (current <= 0 ? rankedSuggestions.length - 1 : current - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              selectSuggestion(rankedSuggestions[activeIndex]);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              onCommit?.(value.trim());
              setIsOpen(false);
              setActiveIndex(-1);
            } else if (event.key === 'Escape') {
              setIsOpen(false);
              setActiveIndex(-1);
            }
          } else if (event.key === 'Enter') {
            event.preventDefault();
            onCommit?.(value.trim());
            setIsOpen(false);
            setActiveIndex(-1);
          }

          onKeyDown?.(event);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shouldShowSuggestions}
        aria-controls={shouldShowSuggestions ? listboxId : undefined}
        aria-activedescendant={shouldShowSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        className={cn(icon && 'pl-9', className)}
      />

      {shouldShowSuggestions && panelStyle ? createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          id={listboxId}
          role="listbox"
          className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          {rankedSuggestions.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">{emptyMessage}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-2">
              {rankedSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.id}-${index}`}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                    index === activeIndex ? 'bg-sky-50' : 'hover:bg-sky-50'
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{suggestion.label}</p>
                    {suggestion.description ? <p className="truncate text-xs text-slate-500">{suggestion.description}</p> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
