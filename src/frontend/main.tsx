import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { setNavigate } from "./lib/navigate";
import { Toaster, toast } from "sonner";
import { ThemeProvider } from "./components/ThemeProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "@fontsource-variable/dm-sans";
import "./css/app.css";

import ProjectDashboard from "./pages/ProjectDashboard";
import ProjectLayout from "./components/ProjectLayout";
import AgentChatView from "./components/AgentChatView";
import AgentSettings from "./pages/AgentSettings";
import ProjectDetails from "./pages/ProjectDetails";
import Settings from "./pages/Settings";
import SharedDrivePage from "./pages/SharedDrive";
import Schedules from "./pages/Schedules";

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

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Toaster position="bottom-right" richColors />
          <BrowserRouter>
            <NavigateBridge />
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
