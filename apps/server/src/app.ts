import { ApiHealthSchema, type ApiHealth } from "@dashboard-rpi5/contracts";
import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

export function buildApp() {
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

  return app;
}
