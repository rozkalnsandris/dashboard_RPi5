import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppShell, DockerPage, OverviewPage, PlaceholderPage, RouteErrorPage } from "./App";
import "./styles.css";

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
      { index: true, element: <OverviewPage /> },
      { path: "docker", element: <DockerPage /> },
      { path: "services", element: <PlaceholderPage /> },
      { path: "logs", element: <PlaceholderPage /> },
      { path: "terminal", element: <PlaceholderPage /> },
      { path: "activity", element: <PlaceholderPage /> },
      { path: "backups", element: <PlaceholderPage /> },
      { path: "deployments", element: <PlaceholderPage /> },
      { path: "settings", element: <PlaceholderPage /> },
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
