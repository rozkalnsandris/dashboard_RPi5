export const TERMINAL_SCREEN_READER_STORAGE_KEY = "dashboard-rpi5.terminal.screen-reader";

export interface TerminalAccessibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TerminalScreenReaderTarget {
  options: {
    screenReaderMode?: boolean;
  };
}

export function readTerminalScreenReaderPreference(
  storage: TerminalAccessibilityStorage | null | undefined,
): boolean {
  if (storage == null) return false;
  try {
    return storage.getItem(TERMINAL_SCREEN_READER_STORAGE_KEY) === "enabled";
  } catch {
    return false;
  }
}

export function persistTerminalScreenReaderPreference(
  storage: TerminalAccessibilityStorage | null | undefined,
  enabled: boolean,
): boolean {
  if (storage == null) return false;
  try {
    storage.setItem(
      TERMINAL_SCREEN_READER_STORAGE_KEY,
      enabled ? "enabled" : "disabled",
    );
    return true;
  } catch {
    return false;
  }
}

export function applyTerminalScreenReaderMode(
  terminal: TerminalScreenReaderTarget | null | undefined,
  enabled: boolean,
): void {
  if (terminal == null) return;
  terminal.options.screenReaderMode = enabled;
}
