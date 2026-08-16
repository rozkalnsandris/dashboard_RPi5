export const QUICK_COMMANDS_ENV = "DASHBOARD_RPI5_QUICK_COMMANDS";
export const QUICK_COMMANDS_ENABLED_VALUE = "enabled";
export const QUICK_COMMANDS_DISABLED_VALUE = "disabled";

export function areQuickCommandsEnabled(value: string | undefined): boolean {
  return value === QUICK_COMMANDS_ENABLED_VALUE;
}
