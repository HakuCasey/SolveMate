import { version } from "../../../package.json";
import type { ClientRuntime } from "@solvemate/contracts";

export function clientRuntime(): ClientRuntime {
  const desktop = import.meta.env.VITE_DESKTOP === "1";
  return {
    appVersion: version,
    buildId: import.meta.env.VITE_APP_BUILD_ID || null,
    clientKind: desktop
      ? "desktop"
      : typeof matchMedia === "function" &&
          matchMedia("(display-mode: standalone)").matches
        ? "pwa"
        : "web",
  };
}
