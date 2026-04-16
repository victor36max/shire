import { use, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppConfig } from "../hooks/auth";
import { getAccessToken, refreshAccessToken } from "../lib/auth";
import { Spinner } from "./ui/spinner";

let refreshAttempted = false;
let refreshPromise: Promise<void> | null = null;

function ensureRefreshed(): Promise<void> {
  if (getAccessToken() || refreshAttempted) return Promise.resolve();
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().then(() => {
      refreshAttempted = true;
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export function resetRefreshState(): void {
  refreshAttempted = false;
  refreshPromise = null;
}

function RefreshGate({ children }: { children: ReactNode }) {
  use(ensureRefreshed());
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
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

  return <RefreshGate>{children}</RefreshGate>;
}
