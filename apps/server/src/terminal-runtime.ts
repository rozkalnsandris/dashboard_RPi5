import {
  CloudflareAccessOwnerAuthVerifier,
  type CloudflareAccessOwnerAuthOptions,
} from "./cloudflare-access-owner-auth.js";
import {
  createTerminalLocalSocket,
  type TerminalLocalConnector,
} from "./terminal-local-client.js";
import {
  createDefaultTerminalSessionAdmission,
  type OwnerAuthVerifier,
  type TerminalSessionAdmission,
} from "./terminal-session-admission.js";
import {
  isTerminalExplicitlyEnabled,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";
import {
  createTerminalWebSocketAdmission,
  type TerminalWebSocketAdmission,
} from "./terminal-websocket-admission.js";

export interface TerminalRuntime {
  terminalEnabled: boolean;
  sessionRegistry: TerminalSessionRegistry;
  sessionAdmission: TerminalSessionAdmission;
  websocketAdmission: TerminalWebSocketAdmission;
  localConnector: TerminalLocalConnector;
}

interface DefaultTerminalRuntimeDependencies {
  sessionRegistry?: TerminalSessionRegistry;
  ownerAuthVerifierFactory?: (
    options: CloudflareAccessOwnerAuthOptions,
  ) => OwnerAuthVerifier;
  localConnector?: TerminalLocalConnector;
}

export function createDefaultTerminalRuntime(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: DefaultTerminalRuntimeDependencies = {},
): TerminalRuntime {
  const terminalEnabled = isTerminalExplicitlyEnabled(env.DASHBOARD_TERMINAL_ENABLED);
  const sessionRegistry = dependencies.sessionRegistry ?? new TerminalSessionRegistry();
  let sharedOwnerAuthVerifier: OwnerAuthVerifier | undefined;

  const sessionAdmission = createDefaultTerminalSessionAdmission(env, {
    sessionRegistry,
    ownerAuthVerifierFactory: (options) => {
      const verifier =
        dependencies.ownerAuthVerifierFactory?.(options) ??
        new CloudflareAccessOwnerAuthVerifier(options);
      sharedOwnerAuthVerifier = verifier;
      return verifier;
    },
  });

  const websocketAdmission = createTerminalWebSocketAdmission({
    terminalEnabled,
    sessionRegistry,
    ...(sharedOwnerAuthVerifier === undefined
      ? {}
      : { ownerAuthVerifier: sharedOwnerAuthVerifier }),
  });

  return {
    terminalEnabled,
    sessionRegistry,
    sessionAdmission,
    websocketAdmission,
    localConnector: dependencies.localConnector ?? createTerminalLocalSocket,
  };
}
