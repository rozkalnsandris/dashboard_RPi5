import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { AppShell, DockerPage, PlaceholderPage, RouteErrorPage } from "./App";
import { ActivityPage } from "./pages/ActivityPage";
import { BackupsPage } from "./pages/BackupsPage";
import { LogsPage } from "./pages/LogsPage";
import { OverviewHistoryPage } from "./pages/OverviewHistoryPage";
import { ReliabilityStatesPage } from "./pages/ReliabilityStatesPage";
import { ServicesPage } from "./pages/ServicesPage";
import { TerminalPage } from "./pages/TerminalPage";
import "./styles.css";
import "./phase1-pages.css";
import "./logs-page.css";
import "./activity-page.css";
import "./backup-page.css";
import "./backup-overview.css";
import "./endpoint-overview.css";
import "./reliability-states.css";
import "./history-panel.css";
import "./services-page.css";
import "./input-mode.css";
import "./navigation.css";

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
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <OverviewHistoryPage /> },
      { path: "docker", element: <DockerPage /> },
      { path: "services", element: <ServicesPage /> },
      { path: "logs", element: <LogsPage /> },
      { path: "terminal", element: <TerminalPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "backups", element: <BackupsPage /> },
      { path: "deployments", element: <PlaceholderPage /> },
      { path: "settings", element: <ReliabilityStatesPage /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
