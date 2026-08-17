import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { LiveAppShell, RouteErrorPage } from "./LiveShell";
import { ActivityPage } from "./pages/ActivityPage";
import { BackupsPage } from "./pages/BackupsPage";
import { DeploymentsPage } from "./pages/DeploymentsPage";
import { LiveDockerPage } from "./pages/LiveDockerPage";
import { LogsPage } from "./pages/LogsPage";
import { OverviewHistoryPage } from "./pages/OverviewHistoryPage";
import { ReliabilityStatesPage } from "./pages/ReliabilityStatesPage";
import { ServicesPage } from "./pages/ServicesPage";
import { TerminalPage } from "./pages/TerminalPage";
import { OfflineBanner } from "./pwa";
import { registerPwaServiceWorker } from "./pwa-register";
import "./styles.css";
import "./phase1-pages.css";
import "./logs-page.css";
import "./activity-page.css";
import "./backup-page.css";
import "./backup-overview.css";
import "./endpoint-overview.css";
import "./deployments-page.css";
import "./reliability-states.css";
import "./history-panel.css";
import "./services-page.css";
import "./quick-commands.css";
import "./terminal-live.css";
import "./input-mode.css";
import "./navigation.css";
import "./pwa.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <LiveAppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <OverviewHistoryPage /> },
      { path: "docker", element: <LiveDockerPage /> },
      { path: "services", element: <ServicesPage /> },
      { path: "logs", element: <LogsPage /> },
      { path: "terminal", element: <TerminalPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "backups", element: <BackupsPage /> },
      { path: "deployments", element: <DeploymentsPage /> },
      { path: "settings", element: <ReliabilityStatesPage /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount element");

registerPwaServiceWorker();

createRoot(root).render(
  <StrictMode>
    <OfflineBanner />
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
