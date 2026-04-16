import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppConfig } from "../hooks/auth";
import { useAuthStore } from "../lib/auth";
import { Spinner } from "./ui/spinner";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: config, isLoading: configLoading } = useAppConfig();
  const { accessToken, refreshAttempted, refreshAccessToken } = useAuthStore();

  useEffect(() => {
    if (config?.authEnabled && !accessToken && !refreshAttempted) {
      refreshAccessToken();
    }
  }, [config?.authEnabled, accessToken, refreshAttempted, refreshAccessToken]);

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (!config?.authEnabled) {
    return <>{children}</>;
  }

  if (!accessToken && !refreshAttempted) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
