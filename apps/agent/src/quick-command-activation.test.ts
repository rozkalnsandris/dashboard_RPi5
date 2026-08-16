import { describe, expect, it } from "vitest";

import {
  QUICK_COMMANDS_DISABLED_VALUE,
  QUICK_COMMANDS_ENABLED_VALUE,
  areQuickCommandsEnabled,
} from "./quick-command-activation.js";

describe("areQuickCommandsEnabled", () => {
  it("enables only the exact reviewed value", () => {
    expect(areQuickCommandsEnabled(QUICK_COMMANDS_ENABLED_VALUE)).toBe(true);
  });

  it.each([
    undefined,
    "",
    QUICK_COMMANDS_DISABLED_VALUE,
    "true",
    "TRUE",
    "1",
    "yes",
    "Enabled",
    " enabled",
    "enabled ",
  ])("fails closed for %j", (value) => {
    expect(areQuickCommandsEnabled(value)).toBe(false);
  });
});
