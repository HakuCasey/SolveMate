import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applicationDataDirectory,
  systemApplicationDirectory,
} from "../apps/desktop/src/runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const portFlags = { web: "port", content: "content-port", local: "local-port" };

export function sourceUserDirectory(environment = process.env) {
  if (environment.SOLVEMATE_USER_DIR || environment.SOLVEMATE_LOCAL_DATA)
    return null;
  return applicationDataDirectory(
    environment.SOLVEMATE_DESKTOP_USER_DIR ||
      systemApplicationDirectory({ environment }),
  );
}

export function localContentServiceUrl(port) {
  return `http://127.0.0.1:${port}/api/v1`;
}

export function localWebOrigins(port) {
  return `http://127.0.0.1:${port},http://localhost:${port}`;
}

export function requestedPorts(values) {
  const defaults = { web: 4173, content: 8000, local: 8765 };
  const ports = {};
  for (const [service, flag] of Object.entries(portFlags)) {
    const raw = values[flag];
    if (raw === undefined && values.isolated && service !== "web") {
      ports[service] = 0;
      continue;
    }
    const value = raw ?? String(defaults[service]);
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535)
      throw new Error(`--${flag} must be an integer from 1 to 65535.`);
    if (Object.values(ports).includes(port))
      throw new Error(
        `Port ${port} is assigned to two services. Choose different ports.`,
      );
    ports[service] = port;
  }
  return ports;
}

// 在构建期间保留监听端口，防止同时启动的实例选中同一个端口。
export async function reservePorts(requested) {
  const listeners = [];
  const ports = {};
  const release = () =>
    Promise.all(
      listeners
        .splice(0)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
  try {
    // 先占用指定端口，再交给系统分配其余端口。
    for (const [service, port] of Object.entries(requested).sort(
      (a, b) => Number(!a[1]) - Number(!b[1]),
    )) {
      const server = createServer((socket) => socket.destroy());
      try {
        await new Promise((accept, reject) => {
          server.once("error", reject);
          server.listen({ host: "127.0.0.1", port, exclusive: true }, accept);
        });
      } catch (error) {
        throw new Error(
          `Cannot use ${service} port ${port}: ${error.message}. Choose another port with --${portFlags[service]}.`,
          { cause: error },
        );
      }
      listeners.push(server);
      ports[service] = server.address().port;
    }
    return { ports, release };
  } catch (error) {
    await release();
    throw error;
  }
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
      port: { type: "string" },
      "content-port": { type: "string" },
      "local-port": { type: "string" },
      isolated: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm start -- [--port N] [--content-port N] [--local-port N] [--isolated]\nDefault ports: web 4173, content 8000, local 8765.\nParallel debugging: npm start -- --isolated --port 4174 (separate data and build, automatic backend ports).",
    );
    return;
  }
  const requested = requestedPorts(values);
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
  const { ports, release } = await reservePorts(requested);
  const port = ports.web;
  const env = {
    ...process.env,
    SOLVEMATE_CONTENT_PORT: String(ports.content),
    SOLVEMATE_LOCAL_PORT: String(ports.local),
    SOLVEMATE_CORS_ORIGINS: localWebOrigins(port),
    SOLVEMATE_LOCAL_ORIGINS: localWebOrigins(port),
    VITE_CONTENT_API_URL: localContentServiceUrl(ports.content),
  };
  const sharedUserDirectory = sourceUserDirectory(env);
  if (sharedUserDirectory) env.SOLVEMATE_USER_DIR = sharedUserDirectory;
  if (values.isolated) {
    const directory = join(root, ".debug-instances", String(port));
    env.SOLVEMATE_USER_DIR = join(directory, "user");
    env.SOLVEMATE_CONTENT_DIR = join(directory, "content");
    env.SOLVEMATE_WEB_OUT_DIR = join(".debug-builds", String(port), "dist");
    delete env.SOLVEMATE_LOCAL_DATA;
    delete env.SOLVEMATE_MATERIALS_DIR;
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
      "import fastapi, uvicorn, solvemate_server, yaml, jsonschema, pypdf, websockets",
    ]);
    await manager.run(
      "Building web application",
      process.execPath,
      [npmCli, "run", "build"],
      { env },
    );
    await manager.run(
      "Publishing community content",
      python,
      ["-m", "solvemate_server.publish"],
      { cwd: serverDirectory, env },
    );
    await release();
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
        String(ports.content),
      ],
      { cwd: serverDirectory, env },
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
        String(ports.local),
      ],
      { env },
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
      { cwd: join(root, "apps/web"), env },
    );
    const serviceExit = Promise.race([api.done, local.done, web.done]).then(
      (result) => {
        throw failure(result);
      },
    );
    await Promise.race([
      Promise.all([
        waitForHttp(`http://127.0.0.1:${port}/`, manager),
        waitForHttp(`http://127.0.0.1:${ports.content}/healthz`, manager),
        waitForHttp(`http://127.0.0.1:${ports.local}/healthz`, manager),
      ]),
      serviceExit,
    ]);
    if (!manager.stopping) {
      console.log(`\n[start] SolveMate is ready: http://127.0.0.1:${port}/`);
      console.log(
        `[start] Community content API: http://127.0.0.1:${ports.content}/docs`,
      );
      console.log(
        `[start] Local AI service: http://127.0.0.1:${ports.local}/healthz`,
      );
      console.log("[start] Press Ctrl+C to stop all services.\n");
    }
    await serviceExit;
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    await release();
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
