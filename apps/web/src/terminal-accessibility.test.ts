import { describe, expect, it } from "vitest";

import {
  applyTerminalScreenReaderMode,
  persistTerminalScreenReaderPreference,
  readTerminalScreenReaderPreference,
  TERMINAL_SCREEN_READER_STORAGE_KEY,
  type TerminalAccessibilityStorage,
} from "./terminal-accessibility";

function memoryStorage(initial: string | null = null): TerminalAccessibilityStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      expect(key).toBe(TERMINAL_SCREEN_READER_STORAGE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(TERMINAL_SCREEN_READER_STORAGE_KEY);
      this.value = value;
    },
  };
}

describe("terminal accessibility preference", () => {
  it("defaults fail-closed to standard xterm mode", () => {
    expect(readTerminalScreenReaderPreference(undefined)).toBe(false);
    expect(readTerminalScreenReaderPreference(memoryStorage())).toBe(false);
    expect(readTerminalScreenReaderPreference(memoryStorage("unexpected"))).toBe(false);
  });

  it("accepts only the exact enabled browser-local preference", () => {
    expect(readTerminalScreenReaderPreference(memoryStorage("enabled"))).toBe(true);
    expect(readTerminalScreenReaderPreference(memoryStorage("disabled"))).toBe(false);
  });

  it("persists only a bounded enabled/disabled preference value", () => {
    const storage = memoryStorage();
    expect(persistTerminalScreenReaderPreference(storage, true)).toBe(true);
    expect(storage.value).toBe("enabled");
    expect(persistTerminalScreenReaderPreference(storage, false)).toBe(true);
    expect(storage.value).toBe("disabled");
  });

  it("does not make browser storage failures fatal", () => {
    const throwingStorage: TerminalAccessibilityStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readTerminalScreenReaderPreference(throwingStorage)).toBe(false);
    expect(persistTerminalScreenReaderPreference(throwingStorage, true)).toBe(false);
  });

  it("updates a mounted terminal without recreating the session", () => {
    const terminal = { options: { screenReaderMode: false } };
    applyTerminalScreenReaderMode(terminal, true);
    expect(terminal.options.screenReaderMode).toBe(true);
    applyTerminalScreenReaderMode(terminal, false);
    expect(terminal.options.screenReaderMode).toBe(false);
  });
});
