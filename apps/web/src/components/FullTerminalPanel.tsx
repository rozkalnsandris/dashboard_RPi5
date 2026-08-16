import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Keyboard, LockKeyhole, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";

import {
  createTerminalSession,
  createTerminalWebSocket,
  parseTerminalServerFrame,
  serializeTerminalInputFrames,
  serializeTerminalResizeFrame,
  TerminalSessionRequestError,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "../terminal-live-api";

import "@xterm/xterm/css/xterm.css";

type TerminalPhase =
  | "idle"
  | "starting"
  | "connecting"
  | "ready"
  | "ended"
  | "unavailable"
  | "denied"
  | "busy"
  | "auth-unavailable"
  | "error";

type Disposable = { dispose(): void };

type ActiveSocket = {
  socket: WebSocket;
  generation: number;
};

const TERMINAL_CLIENT_PROTOCOL_CLOSE_CODE = 4400;
const TERMINAL_CLIENT_ERROR_CLOSE_CODE = 4500;

const phaseCopy: Record<TerminalPhase, { label: string; detail: string }> = {
  idle: {
    label: "Locked",
    detail: "Full terminal locked. Start creates one owner-only, time-limited session.",
  },
  starting: {
    label: "Authorizing",
    detail: "Requesting a fresh one-time terminal capability…",
  },
  connecting: {
    label: "Connecting",
    detail: "Owner admission passed. Waiting for the contained local PTY to become ready…",
  },
  ready: {
    label: "Connected",
    detail: "Interactive session active · 5 min idle · 30 min absolute maximum.",
  },
  ended: {
    label: "Ended",
    detail: "Session ended. Starting again always requests a fresh one-time capability.",
  },
  unavailable: {
    label: "Disabled",
    detail: "Full terminal is disabled on this host. Quick Commands remain available above.",
  },
  denied: {
    label: "Denied",
    detail: "Owner admission was not accepted. No terminal session was created.",
  },
  busy: {
    label: "Busy",
    detail: "The single terminal session slot is already in use.",
  },
  "auth-unavailable": {
    label: "Auth unavailable",
    detail: "Owner authentication could not be verified. The terminal stayed closed.",
  },
  error: {
    label: "Unavailable",
    detail: "The terminal connection ended fail-closed. Start again to request a fresh session.",
  },
};

export function FullTerminalPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<ActiveSocket | null>(null);
  const inputDisposableRef = useRef<Disposable | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const readyRef = useRef(false);
  const generationRef = useRef(0);
  const lastResizeRef = useRef("");

  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [terminalMounted, setTerminalMounted] = useState(false);

  const cleanupRuntimeListeners = useCallback(() => {
    inputDisposableRef.current?.dispose();
    inputDisposableRef.current = null;
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
    readyRef.current = false;
    lastResizeRef.current = "";
    if (terminalRef.current !== null) {
      terminalRef.current.options.disableStdin = true;
    }
  }, []);

  const closeActiveSocket = useCallback((code = 1000, reason = "CLIENT_DISCONNECT") => {
    const active = socketRef.current;
    socketRef.current = null;
    cleanupRuntimeListeners();
    if (active === null) return;
    try {
      if (active.socket.readyState === WebSocket.OPEN || active.socket.readyState === WebSocket.CONNECTING) {
        active.socket.close(code, reason);
      }
    } catch {
      // A stale/closing WebSocket is already fail-closed; do not surface browser-native details.
    }
  }, [cleanupRuntimeListeners]);

  const disposeTerminal = useCallback(() => {
    cleanupRuntimeListeners();
    terminalRef.current?.dispose();
    terminalRef.current = null;
    setTerminalMounted(false);
  }, [cleanupRuntimeListeners]);

  const fitTerminal = useCallback((terminal: Terminal, fitAddon: FitAddon, socket: WebSocket) => {
    try {
      fitAddon.fit();
      const cols = clamp(terminal.cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
      const rows = clamp(terminal.rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
      if (terminal.cols !== cols || terminal.rows !== rows) {
        terminal.resize(cols, rows);
      }
      if (!readyRef.current || socketRef.current?.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const resizeKey = `${cols}x${rows}`;
      if (resizeKey === lastResizeRef.current) return;
      const frame = serializeTerminalResizeFrame(cols, rows);
      if (frame === null) return;
      socket.send(frame);
      lastResizeRef.current = resizeKey;
    } catch {
      // Transient zero-sized mobile viewports are handled by the next ResizeObserver/visualViewport event.
    }
  }, []);

  const installResizeLifecycle = useCallback((terminal: Terminal, fitAddon: FitAddon, socket: WebSocket) => {
    const host = hostRef.current;
    if (host === null) return () => {};

    let animationFrame = 0;
    const scheduleFit = () => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        fitTerminal(terminal, fitAddon, socket);
      });
    };

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    window.addEventListener("resize", scheduleFit);
    window.visualViewport?.addEventListener("resize", scheduleFit);
    scheduleFit();

    const cleanup = () => {
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
      window.visualViewport?.removeEventListener("resize", scheduleFit);
    };
    resizeCleanupRef.current = cleanup;
    return scheduleFit;
  }, [fitTerminal]);

  const finishRemoteConnection = useCallback((socket: WebSocket, nextPhase: TerminalPhase) => {
    if (socketRef.current?.socket !== socket) return;
    socketRef.current = null;
    cleanupRuntimeListeners();
    setPhase(nextPhase);
  }, [cleanupRuntimeListeners]);

  const startTerminal = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    startAbortRef.current?.abort();
    closeActiveSocket();
    disposeTerminal();
    setInputNotice(null);
    setPhase("starting");

    const controller = new AbortController();
    startAbortRef.current = controller;

    try {
      const grant = await createTerminalSession(controller.signal);
      if (generationRef.current !== generation || controller.signal.aborted) return;
      startAbortRef.current = null;

      const host = hostRef.current;
      if (host === null) {
        setPhase("error");
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        disableStdin: true,
        fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: window.matchMedia("(max-width: 600px)").matches ? 13 : 14,
        lineHeight: 1.16,
        scrollback: 2_000,
        minimumContrastRatio: 4.5,
        screenReaderMode: false,
        theme: {
          background: "#05080d",
          foreground: "#e4ebf5",
          cursor: "#8db0ff",
          cursorAccent: "#05080d",
          selectionBackground: "#2d4f8f99",
          black: "#111821",
          red: "#ff7180",
          green: "#6ee7a0",
          yellow: "#f1c75b",
          blue: "#7aa2ff",
          magenta: "#c89cff",
          cyan: "#67dfe3",
          white: "#dce6f3",
          brightBlack: "#6f7d90",
          brightRed: "#ff93a0",
          brightGreen: "#90f0b5",
          brightYellow: "#ffe08b",
          brightBlue: "#9bb7ff",
          brightMagenta: "#d9b8ff",
          brightCyan: "#93eef0",
          brightWhite: "#ffffff",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      terminalRef.current = terminal;
      setTerminalMounted(true);

      const socket = createTerminalWebSocket(grant.sessionToken);
      socketRef.current = { socket, generation };
      const scheduleFit = installResizeLifecycle(terminal, fitAddon, socket);

      inputDisposableRef.current = terminal.onData((data) => {
        if (!readyRef.current || socketRef.current?.socket !== socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const serialized = serializeTerminalInputFrames(data);
        if (!serialized.ok) {
          setInputNotice(
            serialized.reason === "NUL"
              ? "That control input is not supported by the bounded terminal protocol."
              : "That input event is too large; paste a smaller block.",
          );
          return;
        }
        setInputNotice(null);
        for (const frame of serialized.frames) socket.send(frame);
      });

      socket.addEventListener("open", () => {
        if (socketRef.current?.socket === socket) setPhase("connecting");
      });

      socket.addEventListener("message", (event) => {
        if (socketRef.current?.socket !== socket || generationRef.current !== generation) return;
        if (typeof event.data !== "string") {
          closeActiveSocket(TERMINAL_CLIENT_PROTOCOL_CLOSE_CODE, "CLIENT_PROTOCOL_ERROR");
          setPhase("error");
          return;
        }
        const frame = parseTerminalServerFrame(event.data);
        if (frame === null) {
          closeActiveSocket(TERMINAL_CLIENT_PROTOCOL_CLOSE_CODE, "CLIENT_PROTOCOL_ERROR");
          setPhase("error");
          return;
        }

        switch (frame.type) {
          case "ready":
            if (readyRef.current) {
              closeActiveSocket(TERMINAL_CLIENT_PROTOCOL_CLOSE_CODE, "CLIENT_PROTOCOL_ERROR");
              setPhase("error");
              return;
            }
            readyRef.current = true;
            terminal.options.disableStdin = false;
            setPhase("ready");
            scheduleFit();
            break;
          case "output":
            if (!readyRef.current) {
              closeActiveSocket(TERMINAL_CLIENT_PROTOCOL_CLOSE_CODE, "CLIENT_PROTOCOL_ERROR");
              setPhase("error");
              return;
            }
            terminal.write(frame.data);
            break;
          case "exit":
            terminal.options.disableStdin = true;
            terminal.write(`\r\n\x1b[2m[Session ended · exit ${frame.exitCode}]\x1b[0m\r\n`);
            closeActiveSocket(1000, "CLIENT_SESSION_COMPLETE");
            setPhase("ended");
            break;
        }
      });

      socket.addEventListener("close", (event) => {
        if (socketRef.current?.socket !== socket || generationRef.current !== generation) return;
        const nextPhase = event.code === 1000
          ? "ended"
          : event.code === 1008 || event.code === 1013
            ? "ended"
            : "error";
        finishRemoteConnection(socket, nextPhase);
      });

      socket.addEventListener("error", () => {
        if (socketRef.current?.socket !== socket || generationRef.current !== generation) return;
        closeActiveSocket(TERMINAL_CLIENT_ERROR_CLOSE_CODE, "CLIENT_CONNECTION_ERROR");
        setPhase("error");
      });
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      startAbortRef.current = null;
      if (error instanceof TerminalSessionRequestError) {
        switch (error.kind) {
          case "TERMINAL_UNAVAILABLE":
            setPhase("unavailable");
            return;
          case "ADMISSION_DENIED":
            setPhase("denied");
            return;
          case "SESSION_LIMIT":
            setPhase("busy");
            return;
          case "AUTH_UNAVAILABLE":
            setPhase("auth-unavailable");
            return;
          case "INVALID_RESPONSE":
          case "REQUEST_FAILED":
            setPhase("error");
            return;
        }
      }
      setPhase("error");
    }
  }, [closeActiveSocket, disposeTerminal, finishRemoteConnection, installResizeLifecycle]);

  const disconnectTerminal = useCallback(() => {
    generationRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    closeActiveSocket();
    setPhase("ended");
    setInputNotice(null);
  }, [closeActiveSocket]);

  const focusKeyboard = useCallback(() => {
    if (phase === "ready") terminalRef.current?.focus();
  }, [phase]);

  useEffect(() => () => {
    generationRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    closeActiveSocket();
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, [closeActiveSocket]);

  const isStarting = phase === "starting" || phase === "connecting";
  const isConnected = phase === "ready";
  const canStart = !isStarting && !isConnected;
  const copy = phaseCopy[phase];

  return (
    <section className="panel full-terminal-panel" aria-labelledby="full-terminal-title">
      <div className="full-terminal-heading">
        <div>
          <p className="eyebrow">Owner-only · interactive PTY</p>
          <h2 id="full-terminal-title">Full terminal</h2>
        </div>
        <span className={`terminal-session-state terminal-session-state--${phase}`} role="status" aria-live="polite">
          {copy.label}
        </span>
      </div>

      <div className="full-terminal-summary">
        <LockKeyhole size={18} aria-hidden="true" />
        <p>{copy.detail}</p>
      </div>

      <div className="full-terminal-controls" aria-label="Full terminal controls">
        <Button
          className="full-terminal-button full-terminal-button--primary"
          isDisabled={!canStart}
          onPress={() => void startTerminal()}
        >
          <TerminalSquare size={18} aria-hidden="true" />
          {phase === "ended" || phase === "error" ? "Start new session" : "Start terminal"}
        </Button>
        <Button
          className="full-terminal-button"
          isDisabled={!isConnected}
          onPress={focusKeyboard}
        >
          <Keyboard size={18} aria-hidden="true" />
          Open keyboard
        </Button>
        <Button
          className="full-terminal-button"
          isDisabled={!isStarting && !isConnected}
          onPress={disconnectTerminal}
        >
          Disconnect
        </Button>
      </div>

      {inputNotice !== null ? <p className="full-terminal-input-notice" role="status">{inputNotice}</p> : null}

      <div className="full-terminal-frame" data-terminal-mounted={terminalMounted ? "true" : "false"}>
        <div ref={hostRef} className="full-terminal-viewport" aria-label="Interactive terminal viewport" />
        {!terminalMounted ? (
          <div className="full-terminal-placeholder" aria-hidden="true">
            <TerminalSquare size={30} />
            <span>Terminal remains closed until you press Start terminal.</span>
          </div>
        ) : null}
      </div>

      <p className="full-terminal-privacy">
        Session tokens stay in memory only and are never placed in the URL or browser storage. Terminal output is rendered live and is not persisted by the dashboard.
      </p>
    </section>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
