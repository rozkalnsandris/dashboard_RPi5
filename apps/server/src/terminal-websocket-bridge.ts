import { Buffer } from "node:buffer";
import type { Socket } from "node:net";
import { TextDecoder } from "node:util";

import {
  parseTerminalClientMessage,
  serializeTerminalExitFrame,
  serializeTerminalOutputFrame,
  serializeTerminalReadyFrame,
} from "./terminal-application-protocol.js";
import {
  TERMINAL_LOCAL_CONNECT_TIMEOUT_MS,
  type TerminalLocalConnector,
} from "./terminal-local-client.js";
import {
  serializeTerminalLocalInputFrame,
  serializeTerminalLocalOpenFrame,
  serializeTerminalLocalResizeFrame,
  TerminalLocalServerLineDecoder,
  type TerminalLocalErrorCode,
  type TerminalLocalServerFrame,
} from "./terminal-local-wire.js";
import type { TerminalSessionRegistry } from "./terminal-session-security.js";

export const TERMINAL_BRIDGE_MAX_LOCAL_WRITE_BUFFER_BYTES = 64 * 1024;
export const TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES = 64 * 1024;
export const TERMINAL_BRIDGE_MAX_WEBSOCKET_FRAME_BYTES = 32 * 1024;
export const TERMINAL_BRIDGE_READY_TIMEOUT_MS = 5_000;
export const TERMINAL_BRIDGE_EXIT_SEND_TIMEOUT_MS = 2_000;

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

type TerminalBridgeState =
  | "connecting"
  | "awaiting-ready"
  | "active"
  | "closing"
  | "closed";

type TerminalBridgeFailureCloseCode = 1008 | 1011 | 1013;

export type TerminalBridgeFailureReason =
  | "TERMINAL_LOCAL_UNAVAILABLE"
  | "TERMINAL_OUTPUT_OVERLOAD"
  | "TERMINAL_OUTPUT_BACKPRESSURE"
  | "TERMINAL_WEBSOCKET_SEND_FAILED"
  | "TERMINAL_LOCAL_PROTOCOL_ERROR"
  | "TERMINAL_SESSION_EXPIRED"
  | "TERMINAL_LOCAL_BACKPRESSURE"
  | "TERMINAL_PTY_UNAVAILABLE"
  | "TERMINAL_NOT_READY"
  | "TERMINAL_PROTOCOL_ERROR"
  | "TERMINAL_LOCAL_READY_TIMEOUT"
  | "TERMINAL_LOCAL_CLOSED"
  | "TERMINAL_LOCAL_CONNECT_TIMEOUT";

export type TerminalBridgeObservation =
  | { event: "WS_OPEN" }
  | { event: "LOCAL_CONNECTED" }
  | { event: "READY" }
  | { event: "WS_CLOSE"; closeCode: number | null }
  | { event: "WS_ERROR" }
  | {
      event: "FAIL";
      closeCode: TerminalBridgeFailureCloseCode;
      failReason: TerminalBridgeFailureReason;
    };

export type TerminalBridgeObserver = (observation: TerminalBridgeObservation) => void;

export interface TerminalBridgeWebSocket {
  readonly bufferedAmount: number;
  send(data: string, callback?: (error?: Error | null) => void): void;
  close(code: number, reason: string): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  once(event: "error", listener: () => void): unknown;
}

interface TerminalWebSocketBridgeOptions {
  socket: TerminalBridgeWebSocket;
  sessionToken: string;
  sessionRegistry: TerminalSessionRegistry;
  localConnector: TerminalLocalConnector;
  observe?: TerminalBridgeObserver;
  setTimer?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function attachTerminalWebSocketBridge(options: TerminalWebSocketBridgeOptions): void {
  const socket = options.socket;
  const sessionRegistry = options.sessionRegistry;
  const setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const decoder = new TerminalLocalServerLineDecoder();
  const observe = (observation: TerminalBridgeObservation) => {
    try {
      options.observe?.(observation);
    } catch {
      // Diagnostic reporting must never alter terminal fail-closed behavior.
    }
  };

  let state: TerminalBridgeState = "connecting";
  let localSocket: Socket | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let readyTimer: NodeJS.Timeout | undefined;
  let exitSendTimer: NodeJS.Timeout | undefined;
  let revoked = false;

  observe({ event: "WS_OPEN" });

  const revokeSession = () => {
    if (revoked) return;
    revoked = true;
    sessionRegistry.revoke(options.sessionToken);
  };

  const clearConnectTimer = () => {
    if (connectTimer !== undefined) clearTimer(connectTimer);
    connectTimer = undefined;
  };

  const clearReadyTimer = () => {
    if (readyTimer !== undefined) clearTimer(readyTimer);
    readyTimer = undefined;
  };

  const clearExitSendTimer = () => {
    if (exitSendTimer !== undefined) clearTimer(exitSendTimer);
    exitSendTimer = undefined;
  };

  const destroyLocal = () => {
    if (localSocket !== undefined && !localSocket.destroyed) localSocket.destroy();
  };

  const terminateWebSocket = () => {
    try {
      socket.terminate();
    } catch {
      // No further transport action is available.
    }
  };

  const finish = (
    closeWebSocket: boolean,
    code: TerminalBridgeFailureCloseCode = 1011,
    reason: TerminalBridgeFailureReason = "TERMINAL_LOCAL_UNAVAILABLE",
  ) => {
    if (state === "closed") return;
    state = "closed";
    clearConnectTimer();
    clearReadyTimer();
    clearExitSendTimer();
    revokeSession();
    destroyLocal();
    if (!closeWebSocket) return;
    observe({ event: "FAIL", closeCode: code, failReason: reason });
    try {
      socket.close(code, reason);
    } catch {
      terminateWebSocket();
    }
  };

  const failPolicy = (reason: TerminalBridgeFailureReason) => finish(true, 1008, reason);
  const failOverload = (reason: TerminalBridgeFailureReason) => finish(true, 1013, reason);
  const failInternal = (reason: TerminalBridgeFailureReason) => finish(true, 1011, reason);

  const browserFrameCanBeSent = (frame: string): boolean => {
    const frameBytes = Buffer.byteLength(frame, "utf8");
    if (frameBytes > TERMINAL_BRIDGE_MAX_WEBSOCKET_FRAME_BYTES) {
      failOverload("TERMINAL_OUTPUT_OVERLOAD");
      return false;
    }

    // ws bufferedAmount reports queued application-data bytes. Keep this application-level
    // queue budget exact in serialized UTF-8 payload bytes rather than guessing transport
    // framing overhead that bufferedAmount itself does not expose.
    const bufferedAmount = socket.bufferedAmount;
    if (!Number.isSafeInteger(bufferedAmount) || bufferedAmount < 0) {
      failOverload("TERMINAL_OUTPUT_BACKPRESSURE");
      return false;
    }
    if (bufferedAmount > TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES - frameBytes) {
      failOverload("TERMINAL_OUTPUT_BACKPRESSURE");
      return false;
    }
    return true;
  };

  const sendBrowserFrame = (frame: string): boolean => {
    if (state === "closed" || state === "closing") return false;
    if (!browserFrameCanBeSent(frame)) return false;
    try {
      socket.send(frame, (error) => {
        if (error !== undefined && error !== null) {
          failInternal("TERMINAL_WEBSOCKET_SEND_FAILED");
        }
      });
      return true;
    } catch {
      failInternal("TERMINAL_WEBSOCKET_SEND_FAILED");
      return false;
    }
  };

  const sendExitFrameThenClose = (frame: string) => {
    if (state !== "active") {
      failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
      return;
    }
    if (!browserFrameCanBeSent(frame)) return;

    state = "closing";
    clearConnectTimer();
    clearReadyTimer();
    revokeSession();
    destroyLocal();

    exitSendTimer = setTimer(() => {
      if (state !== "closing") return;
      state = "closed";
      terminateWebSocket();
    }, TERMINAL_BRIDGE_EXIT_SEND_TIMEOUT_MS);
    exitSendTimer.unref();

    try {
      socket.send(frame, (error) => {
        if (state !== "closing") return;
        clearExitSendTimer();
        state = "closed";
        if (error !== undefined && error !== null) {
          terminateWebSocket();
          return;
        }
        try {
          socket.close(1000, "TERMINAL_EXIT");
        } catch {
          terminateWebSocket();
        }
      });
    } catch {
      clearExitSendTimer();
      state = "closed";
      terminateWebSocket();
    }
  };

  const writeLocalFrame = (frame: string): boolean => {
    if (
      state === "closed" ||
      state === "closing" ||
      localSocket === undefined ||
      localSocket.destroyed ||
      localSocket.writableEnded
    ) {
      failInternal("TERMINAL_LOCAL_UNAVAILABLE");
      return false;
    }
    if (localSocket.writableLength >= TERMINAL_BRIDGE_MAX_LOCAL_WRITE_BUFFER_BYTES) {
      failOverload("TERMINAL_LOCAL_BACKPRESSURE");
      return false;
    }
    try {
      if (!localSocket.write(frame, "utf8")) {
        failOverload("TERMINAL_LOCAL_BACKPRESSURE");
        return false;
      }
      return true;
    } catch {
      failInternal("TERMINAL_LOCAL_UNAVAILABLE");
      return false;
    }
  };

  const handleLocalError = (code: TerminalLocalErrorCode) => {
    switch (code) {
      case "SESSION_EXPIRED":
        failPolicy("TERMINAL_SESSION_EXPIRED");
        return;
      case "OUTPUT_OVERFLOW":
        failOverload("TERMINAL_OUTPUT_OVERLOAD");
        return;
      case "PROTOCOL_ERROR":
        failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
        return;
      case "PTY_UNAVAILABLE":
        failInternal("TERMINAL_PTY_UNAVAILABLE");
        return;
    }
  };

  const handleLocalFrame = (frame: TerminalLocalServerFrame) => {
    if (state === "closed" || state === "closing") return;
    switch (frame.type) {
      case "ready":
        if (state !== "awaiting-ready") {
          failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
          return;
        }
        clearReadyTimer();
        if (sessionRegistry.touchClaimedTransport(options.sessionToken) === null) {
          failPolicy("TERMINAL_SESSION_EXPIRED");
          return;
        }
        state = "active";
        observe({ event: "READY" });
        sendBrowserFrame(serializeTerminalReadyFrame());
        return;
      case "output":
        if (state !== "active") {
          failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
          return;
        }
        sendBrowserFrame(serializeTerminalOutputFrame(frame.data));
        return;
      case "exit":
        if (state !== "active") {
          failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
          return;
        }
        sendExitFrameThenClose(
          serializeTerminalExitFrame({
            exitCode: frame.code ?? 0,
            ...(frame.signal === null ? {} : { signal: frame.signal }),
          }),
        );
        return;
      case "error":
        handleLocalError(frame.code);
        return;
    }
  };

  const handleBrowserMessage = (data: unknown, isBinary: boolean) => {
    if (state === "closed" || state === "closing") return;
    if (state !== "active") {
      failPolicy("TERMINAL_NOT_READY");
      return;
    }
    if (isBinary) {
      failPolicy("TERMINAL_PROTOCOL_ERROR");
      return;
    }

    const text = decodeWebSocketText(data);
    if (text === null) {
      failPolicy("TERMINAL_PROTOCOL_ERROR");
      return;
    }
    const parsed = parseTerminalClientMessage(text);
    if (!parsed.parsed) {
      failPolicy("TERMINAL_PROTOCOL_ERROR");
      return;
    }
    if (sessionRegistry.touchClaimedTransport(options.sessionToken) === null) {
      failPolicy("TERMINAL_SESSION_EXPIRED");
      return;
    }

    switch (parsed.message.type) {
      case "input":
        try {
          writeLocalFrame(serializeTerminalLocalInputFrame(parsed.message.data));
        } catch {
          failPolicy("TERMINAL_PROTOCOL_ERROR");
        }
        return;
      case "resize":
        try {
          writeLocalFrame(
            serializeTerminalLocalResizeFrame(parsed.message.cols, parsed.message.rows),
          );
        } catch {
          failPolicy("TERMINAL_PROTOCOL_ERROR");
        }
        return;
    }
  };

  // Attach browser handlers synchronously before beginning asynchronous local IPC work.
  socket.on("message", handleBrowserMessage);
  socket.once("close", (code?: number) => {
    observe({ event: "WS_CLOSE", closeCode: normalizeWebSocketCloseCode(code) });
    finish(false);
  });
  socket.once("error", () => {
    observe({ event: "WS_ERROR" });
    finish(false);
  });

  try {
    localSocket = options.localConnector();
  } catch {
    failInternal("TERMINAL_LOCAL_UNAVAILABLE");
    return;
  }

  localSocket.once("connect", () => {
    if (state === "closed" || state === "closing") return;
    clearConnectTimer();
    state = "awaiting-ready";
    observe({ event: "LOCAL_CONNECTED" });
    readyTimer = setTimer(
      () => failInternal("TERMINAL_LOCAL_READY_TIMEOUT"),
      TERMINAL_BRIDGE_READY_TIMEOUT_MS,
    );
    readyTimer.unref();
    writeLocalFrame(serializeTerminalLocalOpenFrame());
  });
  localSocket.on("data", (chunk: Buffer) => {
    if (state === "closed" || state === "closing") return;
    try {
      const frames = decoder.push(chunk);
      for (const frame of frames) handleLocalFrame(frame);
    } catch {
      failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
    }
  });
  localSocket.once("end", () => {
    if (state === "closed" || state === "closing") return;
    try {
      decoder.end();
    } catch {
      failInternal("TERMINAL_LOCAL_PROTOCOL_ERROR");
      return;
    }
    failInternal("TERMINAL_LOCAL_CLOSED");
  });
  localSocket.once("error", () => {
    if (state !== "closed" && state !== "closing") {
      failInternal("TERMINAL_LOCAL_UNAVAILABLE");
    }
  });
  localSocket.once("close", () => {
    if (state !== "closed" && state !== "closing") {
      failInternal("TERMINAL_LOCAL_CLOSED");
    }
  });

  connectTimer = setTimer(
    () => failInternal("TERMINAL_LOCAL_CONNECT_TIMEOUT"),
    TERMINAL_LOCAL_CONNECT_TIMEOUT_MS,
  );
  connectTimer.unref();
}

function normalizeWebSocketCloseCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 4999
    ? value
    : null;
}

function decodeWebSocketText(data: unknown): string | null {
  if (typeof data === "string") return data;

  let bytes: Uint8Array;
  if (Buffer.isBuffer(data)) {
    bytes = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (Array.isArray(data) && data.every((part) => Buffer.isBuffer(part))) {
    bytes = Buffer.concat(data);
  } else {
    return null;
  }

  try {
    return fatalUtf8.decode(bytes);
  } catch {
    return null;
  }
}
