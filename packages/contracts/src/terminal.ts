import { Static, Type } from "@sinclair/typebox";

export const TerminalSessionCreateRequestSchema = Type.Object(
  {},
  { additionalProperties: false, maxProperties: 0 },
);
export type TerminalSessionCreateRequest = Static<typeof TerminalSessionCreateRequestSchema>;

export const TerminalSessionGrantSchema = Type.Object(
  {
    sessionToken: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: "^[0-9a-f]{64}$",
    }),
    idleTimeoutMs: Type.Integer({ minimum: 300_000, maximum: 300_000 }),
    maxLifetimeMs: Type.Integer({ minimum: 1_800_000, maximum: 1_800_000 }),
  },
  { additionalProperties: false },
);
export type TerminalSessionGrant = Static<typeof TerminalSessionGrantSchema>;

export const TerminalSessionApiErrorSchema = Type.Object(
  {
    error: Type.Union([
      Type.Literal("INVALID_REQUEST"),
      Type.Literal("TERMINAL_UNAVAILABLE"),
      Type.Literal("ADMISSION_DENIED"),
      Type.Literal("SESSION_LIMIT"),
      Type.Literal("AUTH_UNAVAILABLE"),
    ]),
  },
  { additionalProperties: false },
);
export type TerminalSessionApiError = Static<typeof TerminalSessionApiErrorSchema>;
