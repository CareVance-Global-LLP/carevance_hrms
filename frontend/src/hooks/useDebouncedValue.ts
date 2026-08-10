import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delayMs`, so a value wired into a query key stops firing a
 * request per keystroke. Typing "macbook" used to mean seven round trips and
 * seven renders.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebouncedValue;
