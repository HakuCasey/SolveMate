import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function ensurePortAvailable(port) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, accept);
  });
  await new Promise((accept, reject) => {
    server.close((error) => (error ? reject(error) : accept()));
  });
}

export class ProcessManager {
  processes = [];
  stopping = false;
  stopPromise;

  start(name, command, args, options = {}) {
    if (this.stopping) throw new Error("Startup was interrupted.");
    // 独立进程组可同时结束 npm、Vite 等命令创建的子进程。
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      detached: process.platform !== "win32",
      ...options,
    });
    const done = new Promise((accept) => {
      child.once("error", (error) => accept({ name, error, code: null }));
      child.once("exit", (code, signal) => accept({ name, code, signal }));
    });
    const entry = { child, done };
    this.processes.push(entry);
    return entry;
  }

  async run(name, command, args, options) {
    console.log(`[start] ${name}`);
    const entry = this.start(name, command, args, options);
    const result = await entry.done;
    if (result.error || result.code !== 0) throw failure(result);
    // 已结束的准备命令不再参与服务停止，避免以后误用已被复用的 PID。
    this.processes = this.processes.filter((item) => item !== entry);
  }

  isRunning({ child }) {
    if (!child.pid) return false;
    if (process.platform === "win32") {
      return child.exitCode === null && child.signalCode === null;
    }
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (
        error.code === "EPERM" &&
        (child.exitCode !== null || child.signalCode !== null)
      )
        return false;
      throw error;
    }
  }

  signal({ child }, signal) {
    if (!child.pid) return;
    if (process.platform === "win32") {
      return new Promise((accept) => {
        const taskkill = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          {
            stdio: "ignore",
          },
        );
        taskkill.once("error", accept);
        taskkill.once("exit", accept);
      });
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      for (const entry of this.processes) {
        if (this.isRunning(entry)) await this.signal(entry, "SIGTERM");
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        // 先接收退出事件，再检查进程组，避免 macOS 在退出间隙返回 EPERM。
        await delay(50);
        if (!this.processes.some((entry) => this.isRunning(entry))) break;
      }
      for (const entry of this.processes) {
        if (this.isRunning(entry)) await this.signal(entry, "SIGKILL");
      }
      await Promise.all(this.processes.map((entry) => entry.done));
    })();
    return this.stopPromise;
  }
}

function failure(result) {
  return new Error(
    `${result.name} exited unexpectedly: ${result.error?.message ?? result.signal ?? `code ${result.code}`}.`,
  );
}

async function waitForHttp(url, manager) {
  const deadline = Date.now() + 30000;
  while (!manager.stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // 服务创建进程后还需加载应用，收到 HTTP 成功响应才算启动完成。
    }
    await delay(100);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function requireFile(file, message) {
  try {
    await access(file);
  } catch {
    throw new Error(message);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "4173" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm start [-- --port <web-port>]\nDefault ports: web 4173, content service 8000, local AI service 8765.",
    );
    return;
  }
  const port = Number(values.port);
  if (
    !/^\d+$/.test(values.port) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port === 8000 ||
    port === 8765
  ) {
    throw new Error(
      "Web port must be an integer from 1 to 65535 and must differ from content port 8000 and local AI port 8765.",
    );
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run the startup script with npm start.");
  const serverDirectory = join(root, "apps/server");
  const python = join(
    serverDirectory,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const vite = join(root, "node_modules/vite/bin/vite.js");
  await requireFile(
    vite,
    "Web dependencies are missing. Run npm ci in the repository root.",
  );
  await requireFile(
    python,
    "Python environment is missing. Follow apps/server/README.md to install the backend dependencies.",
  );
  for (const candidate of [port, 8000, 8765]) {
    try {
      await ensurePortAvailable(candidate);
    } catch (error) {
      throw new Error(
        `Cannot use port ${candidate}: ${error.message}. Stop the existing service before retrying; use --port to change the web port.`,
      );
    }
  }

  const manager = new ProcessManager();
  let interrupted = false;
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    console.log("\n[start] Stopping SolveMate services...");
    void manager.stop();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await manager.run("Checking backend dependencies", python, [
      "-c",
      "import fastapi, uvicorn, solvemate_server, yaml",
    ]);
    await manager.run("Building web application", process.execPath, [
      npmCli,
      "run",
      "build",
    ]);
    await manager.run(
      "Publishing official content",
      python,
      ["-m", "solvemate_server.publish"],
      { cwd: serverDirectory },
    );
    const api = manager.start(
      "Official content service",
      python,
      [
        "-m",
        "uvicorn",
        "solvemate_server.main:create_app",
        "--factory",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      { cwd: serverDirectory },
    );
    const local = manager.start(
      "Local AI service",
      python,
      [
        "-m",
        "uvicorn",
        "solvemate_local.main:create_app",
        "--factory",
        "--app-dir",
        join(root, "apps/local/src"),
        "--host",
        "127.0.0.1",
        "--port",
        "8765",
      ],
      {
        env: {
          ...process.env,
          SOLVEMATE_LOCAL_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
        },
      },
    );
    const web = manager.start(
      "Web service",
      process.execPath,
      [
        vite,
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { cwd: join(root, "apps/web") },
    );
    const serviceExit = Promise.race([api.done, local.done, web.done]).then(
      (result) => {
        throw failure(result);
      },
    );
    await Promise.race([
      Promise.all([
        waitForHttp(`http://127.0.0.1:${port}/`, manager),
        waitForHttp("http://127.0.0.1:8000/healthz", manager),
        waitForHttp("http://127.0.0.1:8765/healthz", manager),
      ]),
      serviceExit,
    ]);
    if (!manager.stopping) {
      console.log(`\n[start] SolveMate is ready: http://127.0.0.1:${port}/`);
      console.log("[start] Official content API: http://127.0.0.1:8000/docs");
      console.log("[start] Local AI service: http://127.0.0.1:8765/healthz");
      console.log("[start] Press Ctrl+C to stop all services.\n");
    }
    await serviceExit;
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    await manager.stop();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[start] SolveMate exited with an error: ${error.message}`);
    process.exitCode = 1;
  });
}
