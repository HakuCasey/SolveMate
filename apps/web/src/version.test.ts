import { afterEach, expect, it, vi } from "vitest";
import { version as desktopVersion } from "../../desktop/package.json";
import { version as webVersion } from "../../../package.json";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["1", desktopVersion, "desktop"],
  ["", webVersion, "web"],
])(
  "uses the correct package version with VITE_DESKTOP=%s",
  async (desktop, expected, kind) => {
    vi.stubEnv("VITE_DESKTOP", desktop);
    vi.resetModules();
    const { appVersion, clientRuntime } = await import("./version");
    expect(appVersion).toBe(expected);
    expect(clientRuntime()).toMatchObject({
      appVersion: expected,
      clientKind: kind,
    });
  },
);
