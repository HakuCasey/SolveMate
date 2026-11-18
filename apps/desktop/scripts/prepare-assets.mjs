import { spawn } from "node:child_process";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
const resources = join(desktop, "resources");
const runtime = join(desktop, "runtime");
let python =
  process.env.SOLVEMATE_BUILD_PYTHON ||
  join(
    root,
    "apps/server/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );

function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) accept();
      else reject(new Error(`${command} failed: ${signal ?? `code ${code}`}.`));
    });
  });
}

if (!process.env.SOLVEMATE_BUILD_PYTHON) {
  try {
    await access(python);
  } catch {
    python = process.platform === "win32" ? "python" : "python3";
  }
}

if (!process.env.npm_execpath)
  throw new Error(
    "Run the desktop build with npm run desktop:package or npm run desktop:make.",
  );

await run(
  process.execPath,
  [process.env.npm_execpath, "run", "build", "--workspace", "@solvemate/web"],
  {
    cwd: root,
    env: { ...process.env, VITE_DESKTOP: "1" },
  },
);

await run(
  python,
  [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "solvemate-local",
    "--distpath",
    runtime,
    "--workpath",
    join(desktop, ".pyinstaller"),
    "--specpath",
    desktop,
    "--paths",
    join(root, "apps/local/src"),
    "--collect-data",
    "solvemate_local",
    "--hidden-import",
    "uvicorn.logging",
    "--hidden-import",
    "uvicorn.loops.auto",
    "--hidden-import",
    "uvicorn.protocols.http.auto",
    "--hidden-import",
    "uvicorn.protocols.websockets.auto",
    join(desktop, "python/entry.py"),
  ],
  { cwd: root },
);

await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
await Promise.all([
  cp(join(root, "apps/web/dist"), join(resources, "web"), { recursive: true }),
  cp(join(root, "data"), join(resources, "data"), { recursive: true }),
  cp(
    join(runtime, "solvemate-local"),
    join(resources, "local/solvemate-local"),
    {
      recursive: true,
      // PyInstaller 会生成指向同一目录内动态库的相对软链接。
      // 保留链接原文，避免 Node 将其改写为开发机上的绝对路径。
      verbatimSymlinks: true,
    },
  ),
  cp(join(root, "apps/web/public/icon-512.png"), join(resources, "icon.png")),
  cp(join(desktop, "assets/startup.html"), join(resources, "startup.html")),
  cp(join(root, "LICENSE"), join(resources, "LICENSE.txt")),
  cp(
    join(root, "THIRD_PARTY_NOTICES.md"),
    join(resources, "third-party-licenses.txt"),
  ),
]);
