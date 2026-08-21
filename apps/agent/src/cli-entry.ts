import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isDirectCliInvocation(
  invokedPath: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
) {
  if (invokedPath === undefined) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
