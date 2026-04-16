import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  refreshAttempted: boolean;
  refreshPromise: Promise<string | null> | null;
  setAccessToken: (token: string | null) => void;
  reset: () => void;
  refreshAccessToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshAttempted: false,
  refreshPromise: null,

  setAccessToken: (token) => set({ accessToken: token }),

  reset: () => set({ accessToken: null, refreshAttempted: false, refreshPromise: null }),

  refreshAccessToken: () => {
    const { refreshPromise } = get();
    if (refreshPromise) return refreshPromise;

    const promise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          set({ accessToken: null, refreshAttempted: true });
          return null;
        }
        const data = (await res.json()) as { accessToken: string };
        set({ accessToken: data.accessToken, refreshAttempted: true });
        return data.accessToken;
      } catch {
        set({ accessToken: null, refreshAttempted: true });
        return null;
      } finally {
        set({ refreshPromise: null });
      }
    })();

    set({ refreshPromise: promise });
    return promise;
  },
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
