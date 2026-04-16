import { use, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppConfig } from "../hooks/auth";
import { useAuthStore } from "../lib/auth";
import { Spinner } from "./ui/spinner";

let refreshPromise: Promise<void> | null = null;

function ensureRefreshed(): Promise<void> {
  const { accessToken, refreshAttempted, refreshAccessToken } = useAuthStore.getState();
  if (accessToken || refreshAttempted) return Promise.resolve();
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().then(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: config, isLoading } = useAppConfig();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (!config?.authEnabled) {
    return <>{children}</>;
  }

  use(ensureRefreshed());

  if (!useAuthStore.getState().accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
