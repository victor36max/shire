import { useCallback, useEffect } from "react";
import { useSearchParams, useLocation } from "react-router-dom";

function getStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Two-way sync between a URL search param and localStorage.
 *
 * - Reads from the URL param first, falls back to localStorage.
 * - Writes update both the URL param and localStorage.
 * - On route changes, restores the param from localStorage when it's
 *   missing from the URL (unless `disabled` is true).
 */
export function useSyncedParam(
  paramName: string,
  storageKey: string,
  options?: { disabled?: boolean },
): [string | null, (value: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const disabled = options?.disabled ?? false;

  const fromUrl = searchParams.get(paramName);
  const value = fromUrl ?? (disabled ? null : getStored(storageKey));

  // Keep localStorage in sync when the URL param is present
  useEffect(() => {
    if (fromUrl) {
      try {
        localStorage.setItem(storageKey, fromUrl);
      } catch {
        // ignore
      }
    }
  }, [fromUrl, storageKey]);

  // Restore param from localStorage on route change when URL doesn't have it
  useEffect(() => {
    if (disabled) return;
    const stored = getStored(storageKey);
    const params = new URLSearchParams(location.search);
    if (!params.has(paramName) && stored) {
      setSearchParams(
        (prev) => {
          prev.set(paramName, stored);
          return prev;
        },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, disabled, paramName, setSearchParams, storageKey]);

  const setValue = useCallback(
    (newValue: string | null) => {
      try {
        if (newValue) {
          localStorage.setItem(storageKey, newValue);
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        // ignore
      }
      setSearchParams(
        (prev) => {
          if (newValue) {
            prev.set(paramName, newValue);
          } else {
            prev.delete(paramName);
          }
          return prev;
        },
        { replace: true },
      );
    },
    [paramName, storageKey, setSearchParams],
  );

  return [value, setValue];
}
