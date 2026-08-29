export const TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 25_000;
export const TERMINAL_WEBSOCKET_PONG_TIMEOUT_MS = 10_000;

export interface TerminalHeartbeatWebSocket {
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
  once(event: "close" | "error", listener: () => void): unknown;
}

interface TerminalWebSocketHeartbeatOptions {
  setTimer?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function attachTerminalWebSocketHeartbeat(
  socket: TerminalHeartbeatWebSocket,
  options: TerminalWebSocketHeartbeatOptions = {},
): void {
  const setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));

  let closed = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let pongTimer: NodeJS.Timeout | undefined;

  const clearHeartbeatTimer = () => {
    if (heartbeatTimer !== undefined) clearTimer(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const clearPongTimer = () => {
    if (pongTimer !== undefined) clearTimer(pongTimer);
    pongTimer = undefined;
  };

  const stop = () => {
    if (closed) return;
    closed = true;
    clearHeartbeatTimer();
    clearPongTimer();
  };

  const terminate = () => {
    if (closed) return;
    stop();
    try {
      socket.terminate();
    } catch {
      // The transport is already fail-closed.
    }
  };

  const scheduleHeartbeat = () => {
    if (closed) return;
    heartbeatTimer = setTimer(() => {
      heartbeatTimer = undefined;
      if (closed) return;

      try {
        socket.ping();
      } catch {
        terminate();
        return;
      }

      pongTimer = setTimer(() => {
        pongTimer = undefined;
        terminate();
      }, TERMINAL_WEBSOCKET_PONG_TIMEOUT_MS);
      pongTimer.unref();

      scheduleHeartbeat();
    }, TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
  };

  socket.on("pong", () => {
    if (closed) return;
    clearPongTimer();
  });
  socket.once("close", stop);
  socket.once("error", stop);

  scheduleHeartbeat();
}
