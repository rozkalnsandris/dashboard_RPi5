import type { Readable, Writable } from "node:stream";

import {
  loadTerminalNativePtyFactory,
  type TerminalNativePtyFactory,
  type TerminalNativePtyProcess,
} from "./native-pty.js";
import {
  parseTerminalLocalClientFrame,
  serializeTerminalLocalServerFrame,
  splitTerminalLocalOutput,
  TerminalLocalLineDecoder,
  TERMINAL_LOCAL_ABSOLUTE_TIMEOUT_MS,
  TERMINAL_LOCAL_IDLE_TIMEOUT_MS,
  TERMINAL_LOCAL_MAX_PENDING_OUTPUT_BYTES,
  TERMINAL_LOCAL_OPEN_TIMEOUT_MS,
  TERMINAL_LOCAL_OUTPUT_DRAIN_TIMEOUT_MS,
  type TerminalLocalErrorCode,
  type TerminalLocalServerFrame,
} from "./local-protocol.js";

const TERMINAL_LOCAL_MAX_SERIALIZED_FRAME_BYTES = 32 * 1024;

export interface TerminalLocalSessionOptions {
  input: Readable;
  output: Writable;
  loadPtyFactory?: () => TerminalNativePtyFactory;
  setTimer?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function runTerminalLocalSession(options: TerminalLocalSessionOptions): Promise<void> {
  const input = options.input;
  const output = options.output;
  const loadPtyFactory = options.loadPtyFactory ?? loadTerminalNativePtyFactory;
  const setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const decoder = new TerminalLocalLineDecoder();

  let state: "waiting" | "active" | "closed" = "waiting";
  let pty: TerminalNativePtyProcess | undefined;
  let ptyDataSubscription: { dispose(): void } | undefined;
  let ptyExitSubscription: { dispose(): void } | undefined;
  let openTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let absoluteTimer: NodeJS.Timeout | undefined;
  let outputDrainTimer: NodeJS.Timeout | undefined;
  let outputBlocked = false;
  let outputEnding = false;
  let pendingOutputBytes = 0;
  const outputQueue: Array<{ line: string; bytes: number }> = [];

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finishDone = once(() => resolveDone());

  const clearOutputDrainTimer = () => {
    if (outputDrainTimer) clearTimer(outputDrainTimer);
    outputDrainTimer = undefined;
  };

  const clearSessionTimers = () => {
    if (openTimer) clearTimer(openTimer);
    if (idleTimer) clearTimer(idleTimer);
    if (absoluteTimer) clearTimer(absoluteTimer);
    openTimer = undefined;
    idleTimer = undefined;
    absoluteTimer = undefined;
  };

  const disposePtySubscriptions = () => {
    ptyDataSubscription?.dispose();
    ptyExitSubscription?.dispose();
    ptyDataSubscription = undefined;
    ptyExitSubscription = undefined;
  };

  const forceOutputClosed = () => {
    clearOutputDrainTimer();
    if (!output.destroyed) output.destroy();
    finishDone();
  };

  const endOutputWhenFlushed = () => {
    outputEnding = true;
    if (!outputBlocked && outputQueue.length === 0 && !output.writableEnded && !output.destroyed) {
      output.end();
      return;
    }
    if (!outputDrainTimer && !output.destroyed && !output.writableEnded) {
      outputDrainTimer = setTimer(forceOutputClosed, TERMINAL_LOCAL_OUTPUT_DRAIN_TIMEOUT_MS);
    }
  };

  const onDrain = () => {
    outputBlocked = false;
    while (!outputBlocked && outputQueue.length > 0 && !output.destroyed) {
      const item = outputQueue.shift();
      if (!item) break;
      pendingOutputBytes -= item.bytes;
      outputBlocked = !output.write(item.line);
    }
    if (outputBlocked) {
      output.once("drain", onDrain);
    } else if (outputEnding && !output.writableEnded && !output.destroyed) {
      clearOutputDrainTimer();
      output.end();
    }
  };

  const enqueueFrame = (frame: TerminalLocalServerFrame): boolean => {
    if (output.destroyed || output.writableEnded) return false;
    const line = serializeTerminalLocalServerFrame(frame);
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > TERMINAL_LOCAL_MAX_SERIALIZED_FRAME_BYTES) return false;

    if (!outputBlocked && outputQueue.length === 0) {
      outputBlocked = !output.write(line);
      if (outputBlocked) output.once("drain", onDrain);
      return true;
    }

    if (pendingOutputBytes + bytes > TERMINAL_LOCAL_MAX_PENDING_OUTPUT_BYTES) return false;
    outputQueue.push({ line, bytes });
    pendingOutputBytes += bytes;
    return true;
  };

  const cleanupPty = () => {
    disposePtySubscriptions();
    if (!pty) return;
    try {
      pty.kill();
    } catch {
      // The systemd service cgroup remains the final process-tree cleanup authority.
    }
    pty = undefined;
  };

  const closeSession = (closeOptions: {
    killPty: boolean;
    errorCode?: TerminalLocalErrorCode;
    exit?: { code: number | null; signal: number | null };
  }) => {
    if (state === "closed") return;
    state = "closed";
    clearSessionTimers();
    input.removeAllListeners("data");
    input.removeAllListeners("end");
    input.removeAllListeners("error");

    if (closeOptions.killPty) cleanupPty();
    else {
      disposePtySubscriptions();
      pty = undefined;
    }

    if (closeOptions.errorCode) {
      enqueueFrame({ v: 1, type: "error", code: closeOptions.errorCode });
    }
    if (closeOptions.exit) enqueueFrame({ v: 1, type: "exit", ...closeOptions.exit });
    endOutputWhenFlushed();
  };

  const failOutputOverflow = () => {
    outputQueue.length = 0;
    pendingOutputBytes = 0;
    closeSession({ killPty: true, errorCode: "OUTPUT_OVERFLOW" });
  };

  const resetIdleTimer = () => {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = setTimer(
      () => closeSession({ killPty: true, errorCode: "SESSION_EXPIRED" }),
      TERMINAL_LOCAL_IDLE_TIMEOUT_MS,
    );
  };

  const handlePtyOutput = (data: string) => {
    if (state !== "active") return;
    let chunks: string[];
    try {
      chunks = splitTerminalLocalOutput(data);
    } catch {
      failOutputOverflow();
      return;
    }
    for (const chunk of chunks) {
      if (!enqueueFrame({ v: 1, type: "output", data: chunk })) {
        failOutputOverflow();
        return;
      }
    }
  };

  const openSession = (cols: number, rows: number) => {
    if (state !== "waiting") {
      closeSession({ killPty: true, errorCode: "PROTOCOL_ERROR" });
      return;
    }

    let factory: TerminalNativePtyFactory;
    try {
      factory = loadPtyFactory();
      pty = factory.create({ cols, rows });
    } catch {
      closeSession({ killPty: false, errorCode: "PTY_UNAVAILABLE" });
      return;
    }

    state = "active";
    if (openTimer) clearTimer(openTimer);
    openTimer = undefined;
    ptyDataSubscription = pty.onData(handlePtyOutput);
    ptyExitSubscription = pty.onExit((event) => {
      if (state !== "active") return;
      closeSession({
        killPty: false,
        exit: {
          code: Number.isInteger(event.exitCode) ? event.exitCode : null,
          signal: Number.isInteger(event.signal) ? (event.signal ?? null) : null,
        },
      });
    });
    resetIdleTimer();
    if (!enqueueFrame({ v: 1, type: "ready" })) failOutputOverflow();
  };

  const handleFrame = (raw: Uint8Array) => {
    let frame;
    try {
      frame = parseTerminalLocalClientFrame(raw);
    } catch {
      closeSession({ killPty: true, errorCode: "PROTOCOL_ERROR" });
      return;
    }

    if (state === "waiting") {
      if (frame.type !== "open") {
        closeSession({ killPty: false, errorCode: "PROTOCOL_ERROR" });
        return;
      }
      openSession(frame.cols, frame.rows);
      return;
    }

    if (state !== "active") return;
    try {
      switch (frame.type) {
        case "input":
          pty?.write(frame.data);
          resetIdleTimer();
          return;
        case "resize":
          pty?.resize(frame.cols, frame.rows);
          resetIdleTimer();
          return;
        case "close":
          closeSession({ killPty: true });
          return;
        case "open":
          closeSession({ killPty: true, errorCode: "PROTOCOL_ERROR" });
          return;
      }
    } catch {
      closeSession({ killPty: true, errorCode: "PTY_UNAVAILABLE" });
    }
  };

  input.on("data", (chunk: Buffer | string) => {
    if (state === "closed") return;
    try {
      const frames = decoder.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      for (const frame of frames) {
        if (state === "closed") break;
        handleFrame(frame);
      }
    } catch {
      closeSession({ killPty: true, errorCode: "PROTOCOL_ERROR" });
    }
  });

  input.once("end", () => {
    if (state === "closed") return;
    try {
      decoder.end();
    } catch {
      closeSession({ killPty: true, errorCode: "PROTOCOL_ERROR" });
      return;
    }
    closeSession({ killPty: true });
  });
  input.once("error", () => closeSession({ killPty: true }));
  output.once("error", () => {
    clearOutputDrainTimer();
    if (state !== "closed") {
      state = "closed";
      clearSessionTimers();
      cleanupPty();
    }
    finishDone();
  });
  output.once("finish", () => {
    clearOutputDrainTimer();
    finishDone();
  });

  openTimer = setTimer(
    () => closeSession({ killPty: false, errorCode: "PROTOCOL_ERROR" }),
    TERMINAL_LOCAL_OPEN_TIMEOUT_MS,
  );
  absoluteTimer = setTimer(
    () => closeSession({ killPty: true, errorCode: "SESSION_EXPIRED" }),
    TERMINAL_LOCAL_ABSOLUTE_TIMEOUT_MS,
  );

  return done;
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}
