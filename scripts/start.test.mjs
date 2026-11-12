import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ensurePortAvailable, ProcessManager } from "./start.mjs";

async function waitUntil(check) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail("Timed out waiting for the child process.");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("rejects an occupied port without stopping its existing listener", async (t) => {
  const server = createServer();
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  t.after(() => new Promise((accept) => server.close(accept)));
  await assert.rejects(ensurePortAvailable(server.address().port), {
    code: "EADDRINUSE",
  });
  assert.equal(server.listening, true);
});

test("reports a process that cannot be started and can still clean up", async () => {
  const manager = new ProcessManager();
  await assert.rejects(
    manager.run("Missing command", "solvemate-missing-command-for-test", [], {
      stdio: "ignore",
    }),
    /Missing command.*ENOENT/,
  );
  await manager.stop();
});

test(
  "stops both managed services and a descendant that ignores SIGTERM",
  { timeout: 20000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "solvemate-start-"));
    const marker = join(directory, "descendant.pid");
    const manager = new ProcessManager();
    t.after(async () => {
      await manager.stop();
      await rm(directory, { recursive: true, force: true });
    });
    const first = manager.start(
      "First service",
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", process.argv[1]], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `,
        marker,
      ],
      { stdio: "ignore" },
    );
    const second = manager.start(
      "Second service",
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    let descendant;
    await waitUntil(async () => {
      try {
        descendant = Number(await readFile(marker, "utf8"));
        return descendant > 0;
      } catch {
        return false;
      }
    });
    await manager.stop();
    await waitUntil(() => !isAlive(descendant));
    assert.equal(isAlive(first.child.pid), false);
    assert.equal(isAlive(second.child.pid), false);
  },
);

test("a failed preparation command does not leave earlier processes running", async (t) => {
  const manager = new ProcessManager();
  t.after(() => manager.stop());
  const service = manager.start(
    "Existing managed service",
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  await assert.rejects(
    manager.run(
      "Failed preparation",
      process.execPath,
      ["-e", "process.exit(7)"],
      { stdio: "ignore" },
    ),
    /code 7/,
  );
  await manager.stop();
  assert.equal(isAlive(service.child.pid), false);
});

test("invalid CLI options fail before starting services", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./start.mjs", import.meta.url)), "--port", "8000"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((accept) => child.once("exit", accept));
  assert.equal(code, 1);
  assert.match(stderr, /must differ from content port 8000/);
});

test("direct startup without npm explains the required command before preparation", () => {
  const env = { ...process.env };
  delete env.npm_execpath;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./start.mjs", import.meta.url))],
    { env, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run the startup script with npm start/);
  assert.equal(result.stdout, "");
});
