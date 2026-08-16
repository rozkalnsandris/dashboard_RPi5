import { createConnection, type Socket } from "node:net";

export const TERMINAL_LOCAL_SOCKET_PATH = "/run/dashboard-rpi5-terminal.sock";
export const TERMINAL_LOCAL_CONNECT_TIMEOUT_MS = 3_000;

export type TerminalLocalConnector = () => Socket;

export const createTerminalLocalSocket: TerminalLocalConnector = () =>
  createConnection({ path: TERMINAL_LOCAL_SOCKET_PATH });
