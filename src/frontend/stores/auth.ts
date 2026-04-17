import { create } from "zustand";
import { decodeJwt } from "jose";

interface AuthState {
  accessToken: string | null;
  refreshPromise: Promise<string | null> | null;
  setAccessToken: (token: string | null) => void;
  refreshAccessToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshPromise: null,

  setAccessToken: (token) => set({ accessToken: token }),

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
          set({ accessToken: null });
          return null;
        }
        const data = (await res.json()) as { accessToken: string };
        set({ accessToken: data.accessToken });
        return data.accessToken;
      } catch {
        set({ accessToken: null });
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

export function isTokenExpired(token: string): boolean {
  try {
    const { exp } = decodeJwt(token);
    return !exp || exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
