export interface SearchSuggestionOption<T = unknown> {
  id: string | number;
  label: string;
  description?: string;
  value?: string;
  keywords?: string[];
  searchValues?: string[];
  payload?: T;
}

export interface EmployeeSearchSource {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
}

type SuggestionBuilderResult<T> =
  | SearchSuggestionOption<T>
  | SearchSuggestionOption<T>[]
  | null
  | undefined;

export const normalizeSearchValue = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const getSuggestionDisplayValue = <T>(suggestion: SearchSuggestionOption<T>) =>
  String(suggestion.value || suggestion.label || '').trim();

const tokenizeSearchValue = (value: unknown) =>
  normalizeSearchValue(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const buildSearchValues = (values: unknown[]) => values.map((value) => normalizeSearchValue(value)).filter(Boolean);
const buildSearchTokens = (values: unknown[]) => Array.from(new Set(values.flatMap((value) => tokenizeSearchValue(value))));

const scoreSuggestion = <T>(
  suggestion: SearchSuggestionOption<T>,
  normalizedQuery: string,
  queryTokens: string[]
) => {
  const label = normalizeSearchValue(suggestion.label);
  const description = normalizeSearchValue(suggestion.description);
  const sourceValues =
    suggestion.searchValues && suggestion.searchValues.length > 0
      ? suggestion.searchValues
      : [suggestion.label, suggestion.description, suggestion.value, ...(suggestion.keywords || [])];
  const searchValues = buildSearchValues(sourceValues);
  const combined = searchValues.join(' ');
  const tokens = buildSearchTokens(sourceValues);

  if (!combined) {
    return -1;
  }

  if (label === normalizedQuery || description === normalizedQuery) {
    return 1000;
  }

  if (label.startsWith(normalizedQuery)) {
    return 930;
  }

  if (description.startsWith(normalizedQuery)) {
    return 900;
  }

  if (tokens.some((token) => token.startsWith(normalizedQuery))) {
    return 860;
  }

  if (queryTokens.length > 1 && queryTokens.every((token) => tokens.some((candidate) => candidate.startsWith(token)))) {
    return 810;
  }

  if (combined.includes(normalizedQuery)) {
    return 760;
  }

  if (queryTokens.length > 1 && queryTokens.every((token) => combined.includes(token))) {
    return 700;
  }

  return -1;
};

export const matchesSearchFilter = (query: string, values: unknown[]) => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchValues = buildSearchValues(values);
  const combined = searchValues.join(' ');
  const queryTokens = tokenizeSearchValue(normalizedQuery);
  const searchTokens = buildSearchTokens(values);

  if (combined.includes(normalizedQuery)) {
    return true;
  }

  return queryTokens.length > 0 && queryTokens.every((token) => searchTokens.some((candidate) => candidate.startsWith(token) || candidate.includes(token)));
};

export const rankSearchSuggestions = <T>(
  suggestions: SearchSuggestionOption<T>[],
  query: string,
  limit = 8
) => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return suggestions.slice(0, limit);
  }

  return suggestions
    .map((suggestion, index) => ({
      suggestion,
      index,
      score: scoreSuggestion(suggestion, normalizedQuery, tokenizeSearchValue(normalizedQuery)),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .slice(0, limit)
    .map((item) => item.suggestion);
};

export const dedupeSearchSuggestions = <T>(suggestions: SearchSuggestionOption<T>[]) => {
  const seen = new Set<string>();

  return suggestions.filter((suggestion) => {
    const key = String(
      suggestion.id ??
        `${normalizeSearchValue(suggestion.label)}:${normalizeSearchValue(suggestion.description)}:${normalizeSearchValue(suggestion.value)}`
    );

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const buildSearchSuggestions = <T>(
  items: T[],
  buildSuggestion: (item: T, index: number) => SuggestionBuilderResult<T>
) =>
  dedupeSearchSuggestions(
    items.flatMap((item, index) => {
      const nextSuggestion = buildSuggestion(item, index);
      if (!nextSuggestion) {
        return [];
      }

      return Array.isArray(nextSuggestion) ? nextSuggestion : [nextSuggestion];
    })
  );

export const buildEmployeeSearchSuggestions = <T extends EmployeeSearchSource>(employees: T[]) => {
  return buildSearchSuggestions(employees, (employee) => {
    const label = String(employee?.name || '').trim() || String(employee?.email || '').trim();
    const email = String(employee?.email || '').trim();

    if (!label && !email) {
      return null;
    }

    const key =
      employee?.id != null
        ? `employee:${employee.id}`
        : `employee:${normalizeSearchValue(label)}:${normalizeSearchValue(email)}`;

    return {
      id: employee?.id ?? key,
      label,
      description: email && email.toLowerCase() !== label.toLowerCase() ? email : undefined,
      value: label,
      searchValues: [label, email],
      payload: employee,
    };
  });
};
