import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  applicationDataDirectory,
  DESKTOP_PORT,
  belongsToService,
  desktopEnvironment,
  localExecutable,
  systemApplicationDirectory,
  waitForService,
} from "../src/runtime.mjs";

test("accepts navigation only from the exact local service origin", () => {
  const service = `http://127.0.0.1:${DESKTOP_PORT}`;
  assert.equal(belongsToService(`${service}/conversation`, service), true);
  assert.equal(
    belongsToService(`http://127.0.0.1:${DESKTOP_PORT}.example.com`, service),
    false,
  );
  assert.equal(belongsToService("not a url", service), false);
});

test("resolves the packaged local executable for each operating system", () => {
  assert.match(
    localExecutable("/app/resources", "darwin"),
    /local\/solvemate-local\/solvemate-local$/,
  );
  assert.match(
    localExecutable("C:\\app\\resources", "win32"),
    /solvemate-local\.exe$/,
  );
});

test("keeps all desktop data beneath the operating system user directory", () => {
  const environment = desktopEnvironment({
    resourcesDirectory: "/app/resources",
    userDirectory: "/users/test/SolveMate",
    port: 43127,
  });
  assert.equal(
    environment.SOLVEMATE_USER_DIR,
    join("/users/test/SolveMate", "data"),
  );
  assert.equal(
    environment.SOLVEMATE_BUNDLED_DATA,
    join("/app/resources", "data"),
  );
  assert.equal(environment.SOLVEMATE_WEB_DIR, join("/app/resources", "web"));
  assert.equal(environment.SOLVEMATE_LOCAL_ORIGINS, "http://127.0.0.1:43127");
});

test("uses the same system application directory on desktop and source web", () => {
  assert.equal(
    systemApplicationDirectory({ platform: "darwin", home: "/Users/test" }),
    "/Users/test/Library/Application Support/SolveMate",
  );
  assert.equal(
    applicationDataDirectory(
      systemApplicationDirectory({
        platform: "win32",
        home: "C:\\Users\\test",
        environment: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      }),
      "win32",
    ),
    "C:\\Users\\test\\AppData\\Roaming\\SolveMate\\data",
  );
  assert.equal(
    applicationDataDirectory(
      systemApplicationDirectory({
        platform: "linux",
        home: "/home/test",
        environment: { XDG_CONFIG_HOME: "/data/config" },
      }),
      "linux",
    ),
    "/data/config/SolveMate/data",
  );
});

test("accepts only the expected local service health response", async () => {
  await waitForService("http://127.0.0.1:43127", new Promise(() => {}), {
    timeout: 100,
    request: async () => ({
      ok: true,
      async json() {
        return { status: "ok", service: "solvemate-local" };
      },
    }),
  });
});
