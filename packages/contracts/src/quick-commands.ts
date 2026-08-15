import { Static, Type } from "@sinclair/typebox";

export const QuickCommandIdSchema = Type.Union([
  Type.Literal("host.uptime"),
  Type.Literal("host.kernel"),
  Type.Literal("host.disk-root"),
  Type.Literal("host.failed-units"),
]);
export type QuickCommandId = Static<typeof QuickCommandIdSchema>;

export const QuickCommandDefinitionSchema = Type.Object({
  id: QuickCommandIdSchema,
  label: Type.String({ minLength: 1, maxLength: 48 }),
  description: Type.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false });
export type QuickCommandDefinition = Static<typeof QuickCommandDefinitionSchema>;

export const QuickCommandCatalogSchema = Type.Object({
  commands: Type.Array(QuickCommandDefinitionSchema, { minItems: 1, maxItems: 4 }),
}, { additionalProperties: false });
export type QuickCommandCatalog = Static<typeof QuickCommandCatalogSchema>;

export const QuickCommandRunRequestSchema = Type.Object({
  commandId: QuickCommandIdSchema,
}, { additionalProperties: false });
export type QuickCommandRunRequest = Static<typeof QuickCommandRunRequestSchema>;

export const QuickCommandResultSchema = Type.Object({
  commandId: QuickCommandIdSchema,
  status: Type.Union([Type.Literal("SUCCESS"), Type.Literal("FAILED")]),
  startedAt: Type.String({ format: "date-time" }),
  finishedAt: Type.String({ format: "date-time" }),
  durationMs: Type.Integer({ minimum: 0, maximum: 30_000 }),
  exitCode: Type.Union([Type.Integer({ minimum: 0, maximum: 255 }), Type.Null()]),
  stdout: Type.String({ maxLength: 16_384 }),
  stderr: Type.String({ maxLength: 16_384 }),
}, { additionalProperties: false });
export type QuickCommandResult = Static<typeof QuickCommandResultSchema>;

export const QuickCommandQuerySchema = Type.Object({}, { additionalProperties: false });

export const QuickCommandApiErrorSchema = Type.Object({
  error: Type.Union([
    Type.Literal("INVALID_REQUEST"),
    Type.Literal("SOURCE_UNAVAILABLE"),
    Type.Literal("OPERATION_TIMEOUT"),
  ]),
}, { additionalProperties: false });
