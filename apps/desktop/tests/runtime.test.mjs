import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_PORT,
  belongsToService,
  desktopEnvironment,
  localExecutable,
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
  assert.equal(environment.SOLVEMATE_USER_DIR, "/users/test/SolveMate/data");
  assert.equal(environment.SOLVEMATE_BUNDLED_DATA, "/app/resources/data");
  assert.equal(environment.SOLVEMATE_WEB_DIR, "/app/resources/web");
  assert.equal(environment.SOLVEMATE_LOCAL_ORIGINS, "http://127.0.0.1:43127");
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
