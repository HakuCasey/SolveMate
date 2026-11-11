import { version } from "../../../package.json";
import type { ClientRuntime } from "@solvemate/contracts";

export function clientRuntime(): ClientRuntime {
  return {
    appVersion: version,
    buildId: import.meta.env.VITE_APP_BUILD_ID || null,
    clientKind:
      typeof matchMedia === "function" &&
      matchMedia("(display-mode: standalone)").matches
        ? "pwa"
        : "web",
  };
}
