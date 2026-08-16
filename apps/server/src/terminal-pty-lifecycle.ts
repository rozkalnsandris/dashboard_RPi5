import { Buffer } from "node:buffer";

import {
  parseTerminalClientMessage,
  serializeTerminalExitFrame,
  serializeTerminalOutputFrame,
  serializeTerminalReadyFrame,
  splitTerminalOutput,
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_OUTPUT_BUFFER_MAX_BYTES,
  TERMINAL_OUTPUT_EVENT_MAX_BYTES,
  type TerminalExitEvent,
} from "./terminal-application-protocol.js";
import {
  TERMINAL_IDLE_TIMEOUT_MS,
  type TerminalSessionRegistry,
} from "./terminal-session-security.js";

export interface TerminalDisposable {
  dispose(): void;
}

export interface TerminalPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): TerminalDisposable;
  onExit(listener: (event: TerminalExitEvent) => void): TerminalDisposable;
}

export interface TerminalPtyFactory {
  create(options: { cols: number; rows: number }): TerminalPtyProcess;
}

export interface TerminalProtocolSocket {
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface TerminalPtyLifecycleSession {
  handleClientFrame(frame: string, isBinary: boolean): void;
  disconnect(): void;
}

export type TerminalPtyAttachResult =
  | { attached: true; session: TerminalPtyLifecycleSession }
  | { attached: false; reason: "SESSION_NOT_LIVE" | "PTY_SETUP_FAILED" };

interface AttachTerminalPtyLifecycleOptions {
  socket: TerminalProtocolSocket;
  sessionToken: string;
  sessionRegistry: TerminalSessionRegistry;
  ptyFactory: TerminalPtyFactory;
}

export function attachTerminalPtyLifecycle(
  options: AttachTerminalPtyLifecycleOptions,
): TerminalPtyAttachResult {
  const initialMetadata = options.sessionRegistry.touchClaimedTransport(options.sessionToken);
  if (initialMetadata === null) {
    return { attached: false, reason: "SESSION_NOT_LIVE" };
  }

  let pty: TerminalPtyProcess;
  try {
    pty = options.ptyFactory.create({
      cols: TERMINAL_DEFAULT_COLS,
      rows: TERMINAL_DEFAULT_ROWS,
    });
  } catch {
    options.sessionRegistry.revoke(options.sessionToken);
    return { attached: false, reason: "PTY_SETUP_FAILED" };
  }

  let finished = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let maxTimer: NodeJS.Timeout | undefined;
  const disposables: TerminalDisposable[] = [];

  const clearTimers = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    if (maxTimer !== undefined) {
      clearTimeout(maxTimer);
      maxTimer = undefined;
    }
  };

  const disposeListeners = () => {
    for (const disposable of disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // Listener disposal is best-effort after the session has already been terminated.
      }
    }
  };

  const finish = (input: {
    killPty: boolean;
    closeSocket: boolean;
    code: number;
    reason: string;
  }) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimers();
    disposeListeners();
    options.sessionRegistry.revoke(options.sessionToken);

    if (input.killPty) {
      try {
        pty.kill();
      } catch {
        // The process may already be gone; revocation and socket closure still proceed.
      }
    }

    if (input.closeSocket) {
      try {
        options.socket.close(input.code, input.reason);
      } catch {
        // A disconnected socket cannot be closed again.
      }
    }
  };

  const scheduleIdleTimeout = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      finish({
        killPty: true,
        closeSocket: true,
        code: 1008,
        reason: "TERMINAL_IDLE_TIMEOUT",
      });
    }, TERMINAL_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  };

  const absoluteDelayMs = Math.max(
    0,
    initialMetadata.maxExpiresAtMs - initialMetadata.lastActivityAtMs,
  );
  maxTimer = setTimeout(() => {
    finish({
      killPty: true,
      closeSocket: true,
      code: 1008,
      reason: "TERMINAL_MAX_LIFETIME",
    });
  }, absoluteDelayMs);
  maxTimer.unref();
  scheduleIdleTimeout();

  const registerActivity = (): boolean => {
    const metadata = options.sessionRegistry.touchClaimedTransport(options.sessionToken);
    if (metadata === null) {
      finish({
        killPty: true,
        closeSocket: true,
        code: 1008,
        reason: "TERMINAL_SESSION_EXPIRED",
      });
      return false;
    }
    scheduleIdleTimeout();
    return true;
  };

  const sendOutput = (data: string) => {
    if (finished) {
      return;
    }
    if (Buffer.byteLength(data, "utf8") > TERMINAL_OUTPUT_EVENT_MAX_BYTES) {
      finish({
        killPty: true,
        closeSocket: true,
        code: 1013,
        reason: "TERMINAL_OUTPUT_OVERLOAD",
      });
      return;
    }

    for (const chunk of splitTerminalOutput(data)) {
      if (options.socket.bufferedAmount >= TERMINAL_OUTPUT_BUFFER_MAX_BYTES) {
        finish({
          killPty: true,
          closeSocket: true,
          code: 1013,
          reason: "TERMINAL_OUTPUT_OVERLOAD",
        });
        return;
      }

      try {
        options.socket.send(serializeTerminalOutputFrame(chunk));
      } catch {
        finish({
          killPty: true,
          closeSocket: true,
          code: 1011,
          reason: "TERMINAL_TRANSPORT_ERROR",
        });
        return;
      }
    }
  };

  const handleExit = (event: TerminalExitEvent) => {
    if (finished) {
      return;
    }

    try {
      options.socket.send(serializeTerminalExitFrame(event));
    } catch {
      finish({
        killPty: false,
        closeSocket: false,
        code: 1000,
        reason: "TERMINAL_EXIT",
      });
      return;
    }

    finish({
      killPty: false,
      closeSocket: true,
      code: 1000,
      reason: "TERMINAL_EXIT",
    });
  };

  try {
    disposables.push(pty.onData(sendOutput));
    disposables.push(pty.onExit(handleExit));
    options.socket.send(serializeTerminalReadyFrame());
  } catch {
    finish({
      killPty: true,
      closeSocket: true,
      code: 1011,
      reason: "TERMINAL_SETUP_ERROR",
    });
    return { attached: false, reason: "PTY_SETUP_FAILED" };
  }

  return {
    attached: true,
    session: {
      handleClientFrame(frame, isBinary) {
        if (finished) {
          return;
        }
        if (isBinary) {
          finish({
            killPty: true,
            closeSocket: true,
            code: 1008,
            reason: "TERMINAL_PROTOCOL_VIOLATION",
          });
          return;
        }

        const parsed = parseTerminalClientMessage(frame);
        if (!parsed.parsed) {
          finish({
            killPty: true,
            closeSocket: true,
            code: 1008,
            reason: "TERMINAL_PROTOCOL_VIOLATION",
          });
          return;
        }
        if (!registerActivity()) {
          return;
        }

        try {
          if (parsed.message.type === "input") {
            pty.write(parsed.message.data);
          } else {
            pty.resize(parsed.message.cols, parsed.message.rows);
          }
        } catch {
          finish({
            killPty: true,
            closeSocket: true,
            code: 1011,
            reason: "TERMINAL_PTY_ERROR",
          });
        }
      },
      disconnect() {
        finish({
          killPty: true,
          closeSocket: false,
          code: 1000,
          reason: "TERMINAL_DISCONNECTED",
        });
      },
    },
  };
}
