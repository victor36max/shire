import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  refreshAttempted: boolean;
  setAccessToken: (token: string | null) => void;
  reset: () => void;
  refreshAccessToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshAttempted: false,

  setAccessToken: (token) => set({ accessToken: token }),

  reset: () => set({ accessToken: null, refreshAttempted: false }),

  refreshAccessToken: async () => {
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
    }
  },
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
