import {
  CloudflareAccessOwnerAuthVerifier,
  type CloudflareAccessOwnerAuthOptions,
  type CloudflareAccessOwnerAuthResult,
} from "./cloudflare-access-owner-auth.js";
import {
  isTerminalExplicitlyEnabled,
  TERMINAL_IDLE_TIMEOUT_MS,
  TERMINAL_MAX_LIFETIME_MS,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

export interface TerminalSessionAdmissionInput {
  origin: string | undefined;
  accessAssertion: string | undefined;
}

export type TerminalSessionAdmissionResult =
  | {
      status: "CREATED";
      sessionToken: string;
      idleTimeoutMs: number;
      maxLifetimeMs: number;
    }
  | { status: "TERMINAL_UNAVAILABLE" }
  | { status: "ADMISSION_DENIED" }
  | { status: "SESSION_LIMIT" }
  | { status: "AUTH_UNAVAILABLE" };

export type TerminalSessionAdmission = (
  input: TerminalSessionAdmissionInput,
) => Promise<TerminalSessionAdmissionResult>;

export interface OwnerAuthVerifier {
  verifyAssertion(assertion: string | undefined): Promise<CloudflareAccessOwnerAuthResult>;
}

interface CreateTerminalSessionAdmissionOptions {
  terminalEnabled: boolean;
  ownerAuthVerifier?: OwnerAuthVerifier;
  sessionRegistry?: TerminalSessionRegistry;
}

interface DefaultTerminalSessionAdmissionDependencies {
  ownerAuthVerifierFactory?: (
    options: CloudflareAccessOwnerAuthOptions,
  ) => OwnerAuthVerifier;
  sessionRegistry?: TerminalSessionRegistry;
}

export function createTerminalSessionAdmission(
  options: CreateTerminalSessionAdmissionOptions,
): TerminalSessionAdmission {
  const registry = options.sessionRegistry ?? new TerminalSessionRegistry();
  const verifier = options.ownerAuthVerifier;

  if (options.terminalEnabled && verifier === undefined) {
    throw new Error("Enabled terminal admission requires an owner-auth verifier");
  }

  return async (input) => {
    if (!options.terminalEnabled) {
      return { status: "TERMINAL_UNAVAILABLE" };
    }

    let authResult: CloudflareAccessOwnerAuthResult;
    try {
      authResult = await verifier!.verifyAssertion(input.accessAssertion);
    } catch {
      return { status: "AUTH_UNAVAILABLE" };
    }

    if (!authResult.verified) {
      return authResult.reason === "KEY_UNAVAILABLE"
        ? { status: "AUTH_UNAVAILABLE" }
        : { status: "ADMISSION_DENIED" };
    }

    const created = registry.createSession({
      terminalEnabled: true,
      ownerAuthVerified: true,
      origin: input.origin,
    });

    if (!created.created) {
      if (created.reason === "CONCURRENCY_LIMIT") {
        return { status: "SESSION_LIMIT" };
      }
      if (created.reason === "TERMINAL_DISABLED") {
        return { status: "TERMINAL_UNAVAILABLE" };
      }
      return { status: "ADMISSION_DENIED" };
    }

    return {
      status: "CREATED",
      sessionToken: created.session.token,
      idleTimeoutMs: TERMINAL_IDLE_TIMEOUT_MS,
      maxLifetimeMs: TERMINAL_MAX_LIFETIME_MS,
    };
  };
}

export function createDefaultTerminalSessionAdmission(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: DefaultTerminalSessionAdmissionDependencies = {},
): TerminalSessionAdmission {
  const terminalEnabled = isTerminalExplicitlyEnabled(env.DASHBOARD_TERMINAL_ENABLED);
  if (!terminalEnabled) {
    return createTerminalSessionAdmission({
      terminalEnabled: false,
      ...(dependencies.sessionRegistry === undefined
        ? {}
        : { sessionRegistry: dependencies.sessionRegistry }),
    });
  }

  const teamName = readRequiredConfiguration(env, "DASHBOARD_TERMINAL_ACCESS_TEAM");
  const applicationAudience = readRequiredConfiguration(
    env,
    "DASHBOARD_TERMINAL_ACCESS_AUD",
  );
  const ownerEmail = readRequiredConfiguration(env, "DASHBOARD_TERMINAL_OWNER_EMAIL");
  const verifierFactory =
    dependencies.ownerAuthVerifierFactory ??
    ((options: CloudflareAccessOwnerAuthOptions) =>
      new CloudflareAccessOwnerAuthVerifier(options));

  return createTerminalSessionAdmission({
    terminalEnabled: true,
    ownerAuthVerifier: verifierFactory({
      teamName,
      applicationAudience,
      ownerEmail,
    }),
    ...(dependencies.sessionRegistry === undefined
      ? {}
      : { sessionRegistry: dependencies.sessionRegistry }),
  });
}

function readRequiredConfiguration(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0 || value !== value.trim()) {
    throw new Error(`Terminal admission configuration is invalid: ${name}`);
  }
  return value;
}
