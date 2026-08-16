import type { OwnerAuthVerifier } from "./terminal-session-admission.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  type TerminalSessionRegistry,
} from "./terminal-session-security.js";
import { parseTerminalWebSocketProtocolHeader } from "./terminal-websocket-protocol.js";

export interface TerminalWebSocketAdmissionInput {
  origin: string | undefined;
  accessAssertion: string | undefined;
  protocolHeader: string | readonly string[] | undefined;
}

export type TerminalWebSocketAdmissionResult =
  | { status: "ALLOWED"; sessionToken: string }
  | { status: "TERMINAL_UNAVAILABLE" }
  | { status: "ADMISSION_DENIED" }
  | { status: "AUTH_UNAVAILABLE" };

export type TerminalWebSocketAdmission = (
  input: TerminalWebSocketAdmissionInput,
) => Promise<TerminalWebSocketAdmissionResult>;

interface CreateTerminalWebSocketAdmissionOptions {
  terminalEnabled: boolean;
  sessionRegistry: TerminalSessionRegistry;
  ownerAuthVerifier?: OwnerAuthVerifier;
}

export function createTerminalWebSocketAdmission(
  options: CreateTerminalWebSocketAdmissionOptions,
): TerminalWebSocketAdmission {
  const verifier = options.ownerAuthVerifier;
  if (options.terminalEnabled && verifier === undefined) {
    throw new Error("Enabled terminal WebSocket admission requires an owner-auth verifier");
  }

  return async (input) => {
    if (!options.terminalEnabled) {
      return { status: "TERMINAL_UNAVAILABLE" };
    }

    let authResult;
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

    if (input.origin === undefined || input.origin.length === 0) {
      return { status: "ADMISSION_DENIED" };
    }
    if (input.origin !== TERMINAL_EXPECTED_ORIGIN) {
      return { status: "ADMISSION_DENIED" };
    }

    const protocol = parseTerminalWebSocketProtocolHeader(input.protocolHeader);
    if (!protocol.parsed) {
      return { status: "ADMISSION_DENIED" };
    }

    const claim = options.sessionRegistry.claimTransport({
      terminalEnabled: true,
      ownerAuthVerified: true,
      origin: input.origin,
      sessionToken: protocol.sessionToken,
    });
    if (!claim.claimed) {
      return { status: "ADMISSION_DENIED" };
    }

    return {
      status: "ALLOWED",
      sessionToken: protocol.sessionToken,
    };
  };
}
