import { useState, useEffect } from "react";
import { getValidToken } from "../lib/api";
import { useAuthStore } from "../stores/auth";

interface AuthenticatedUrlResult {
  blobUrl: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useAuthenticatedUrl(url: string | null): AuthenticatedUrlResult {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    const fetchResource = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const token = await getValidToken();
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        let res = await fetch(url, { headers, signal: controller.signal });

        if (res.status === 401 && token) {
          const newToken = await useAuthStore.getState().refreshAccessToken();
          if (newToken) {
            headers["Authorization"] = `Bearer ${newToken}`;
            res = await fetch(url, { headers, signal: controller.signal });
          }
        }

        if (!res.ok) {
          throw new Error(`Failed to load resource (${res.status})`);
        }

        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load resource");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchResource();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url]);

  return { blobUrl, isLoading, error };
}
