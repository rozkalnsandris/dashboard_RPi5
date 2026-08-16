import { resolve } from "node:path";

import { buildApp } from "./app.js";
import { registerQuickCommandApiRoutes } from "./quick-command-routes.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const staticRoot = process.env.DASHBOARD_WEB_ROOT;
const app = buildApp({
  ...(staticRoot === undefined ? {} : { staticRoot: resolve(staticRoot) }),
});

registerQuickCommandApiRoutes(app, {
  ...(process.env.DASHBOARD_AGENT_SOCKET_PATH === undefined
    ? {}
    : { socketPath: process.env.DASHBOARD_AGENT_SOCKET_PATH }),
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
