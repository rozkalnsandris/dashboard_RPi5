import { ApiHealthSchema, type ApiHealth } from "@dashboard-rpi5/contracts";
import fastifyStatic from "@fastify/static";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { isAbsolute } from "node:path";

interface BuildAppOptions {
  staticRoot?: string;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: ApiHealthSchema,
        },
      },
    },
    async (): Promise<ApiHealth> => ({
      status: "ok",
      service: "dashboard-rpi5-server",
      mode: "fixture",
      observedAt: new Date().toISOString(),
    }),
  );

  if (options.staticRoot !== undefined) {
    if (!isAbsolute(options.staticRoot)) {
      throw new Error("staticRoot must be an absolute path");
    }

    void app.register(fastifyStatic, {
      root: options.staticRoot,
      maxAge: "30d",
      immutable: true,
      serveDotFiles: false,
      setHeaders(reply, pathName) {
        if (pathName.endsWith("index.html")) {
          reply.header("Cache-Control", "no-store");
        }
      },
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !request.url.startsWith("/api/")
      ) {
        return reply
          .header("Cache-Control", "no-store")
          .sendFile("index.html", { maxAge: 0, immutable: false });
      }

      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }

  return app;
}
