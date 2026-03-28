import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setNavigate } from "./lib/navigate";
import { Toaster, toast } from "sonner";
import { ThemeProvider } from "./components/ThemeProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useConnectionToast } from "./lib/useConnectionToast";
import { Spinner } from "./components/ui/spinner";
import "@fontsource-variable/dm-sans";

import ProjectLayout from "./components/ProjectLayout";

const ProjectDashboard = lazy(() => import("./pages/ProjectDashboard"));
const AgentChatView = lazy(() => import("./components/AgentChatView"));
const AgentSettings = lazy(() => import("./pages/AgentSettings"));
const ProjectDetails = lazy(() => import("./pages/ProjectDetails"));
const Settings = lazy(() => import("./pages/Settings"));
const SharedDrivePage = lazy(() => import("./pages/SharedDrive"));
const Schedules = lazy(() => import("./pages/Schedules"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    },
    mutations: {
      onError: (error: Error) => {
        toast.error(error.message || "Something went wrong");
      },
    },
  },
});

function NavigateBridge() {
  const nav = useNavigate();
  useEffect(() => {
    setNavigate((href, opts) => {
      nav(href, { replace: opts?.replace });
    });
  }, [nav]);
  return null;
}

function ConnectionToastManager() {
  useConnectionToast();
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Toaster position="bottom-right" richColors />
          <ConnectionToastManager />
          <BrowserRouter>
            <NavigateBridge />
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-screen">
                  <Spinner size="lg" className="text-muted-foreground" />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<ProjectDashboard />} />
                <Route path="/projects/:projectName" element={<ProjectLayout />}>
                  <Route index element={<AgentChatView />} />
                  <Route path="agents/:agentName" element={<AgentChatView />} />
                  <Route path="agents/:agentName/settings" element={<AgentSettings />} />
                  <Route path="details" element={<ProjectDetails />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="shared" element={<SharedDrivePage />} />
                  <Route path="schedules" element={<Schedules />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.accept();
}
