import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  applicationDataDirectory,
  DESKTOP_PORT,
  belongsToService,
  clearDesktopHttpCache,
  desktopEnvironment,
  localExecutable,
  prepareDesktopSession,
  systemApplicationDirectory,
  waitForService,
} from "../src/runtime.mjs";

test("opens a new desktop session with the previous browser records but without cached responses", (t) => {
  const root = mkdtempSync(join(tmpdir(), "solvemate-http-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const session = join(root, "desktop-session");
  const legacy = join(root, "system-cache", "SolveMate");
  const response = join(legacy, "Cache", "old-index");
  const database = join(root, "data", "app.sqlite3");
  const retained = [
    join("Local Storage", "prefs"),
    join("IndexedDB", "pending"),
  ];
  for (const file of [
    response,
    database,
    ...retained.map((file) => join(legacy, file)),
  ]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "test fixture");
  }

  prepareDesktopSession(session, legacy);
  clearDesktopHttpCache(legacy);
  clearDesktopHttpCache(legacy);

  assert.equal(existsSync(response), false);
  assert.equal(existsSync(join(session, "Cache")), false);
  for (const file of retained) {
    assert.equal(readFileSync(join(session, file), "utf8"), "test fixture");
    assert.equal(readFileSync(join(legacy, file), "utf8"), "test fixture");
  }
  assert.equal(readFileSync(database, "utf8"), "test fixture");

  const pending = join(session, "IndexedDB", "pending");
  writeFileSync(pending, "new pending change");
  prepareDesktopSession(session, legacy);
  assert.equal(readFileSync(pending, "utf8"), "new pending change");
});

test("creates the session directory on a clean installation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "solvemate-desktop-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const session = join(root, "SolveMate", "desktop-session");
  const legacy = join(root, "system-cache", "SolveMate");

  prepareDesktopSession(session, legacy);
  clearDesktopHttpCache(legacy);

  assert(existsSync(session));
  assert.equal(existsSync(legacy), false);
});

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
