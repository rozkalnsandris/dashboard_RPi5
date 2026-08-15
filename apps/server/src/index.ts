import { buildApp } from "./app.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
