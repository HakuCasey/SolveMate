import { version as webVersion } from "../../../package.json";
import { version as desktopVersion } from "../../desktop/package.json";
import type { ClientRuntime } from "@solvemate/contracts";

const desktop = import.meta.env.VITE_DESKTOP === "1";
export const appVersion = desktop ? desktopVersion : webVersion;

export function clientRuntime(): ClientRuntime {
  return {
    appVersion,
    buildId: import.meta.env.VITE_APP_BUILD_ID || null,
    clientKind: desktop
      ? "desktop"
      : typeof matchMedia === "function" &&
          matchMedia("(display-mode: standalone)").matches
        ? "pwa"
        : "web",
  };
}
