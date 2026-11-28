import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

export const DESKTOP_PORT = 43127;

/** 将旧版存放在系统缓存目录中的记录迁出，替换目录前保留原件。 */
export function prepareDesktopSession(sessionDirectory, legacyDirectory) {
  if (existsSync(sessionDirectory)) return;
  const parent = dirname(sessionDirectory);
  mkdirSync(parent, { recursive: true });
  const staged = mkdtempSync(join(parent, ".desktop-session-"));
  try {
    for (const name of [
      "IndexedDB",
      "Local Storage",
      "Session Storage",
      "WebStorage",
    ]) {
      const previous = join(legacyDirectory, name);
      if (existsSync(previous)) {
        cpSync(previous, join(staged, name), { recursive: true });
      }
    }
    renameSync(staged, sessionDirectory);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

/** 关闭 HTTP 缓存后，Electron 不会主动移除旧的磁盘缓存。 */
export function clearDesktopHttpCache(sessionDirectory) {
  rmSync(join(sessionDirectory, "Cache"), {
    recursive: true,
    force: true,
    maxRetries: 2,
  });
}

function pathsFor(platform) {
  return platform === "win32" ? win32 : posix;
}

/** 返回操作系统为 SolveMate 分配的应用数据目录，源码版与桌面版共用。 */
export function systemApplicationDirectory({
  platform = process.platform,
  environment = process.env,
  home = environment.HOME || environment.USERPROFILE || homedir(),
} = {}) {
  const paths = pathsFor(platform);
  if (platform === "darwin")
    return paths.join(home, "Library", "Application Support", "SolveMate");
  if (platform === "win32")
    return paths.join(
      environment.APPDATA || paths.join(home, "AppData", "Roaming"),
      "SolveMate",
    );
  return paths.join(
    environment.XDG_CONFIG_HOME || paths.join(home, ".config"),
    "SolveMate",
  );
}

export function applicationDataDirectory(
  applicationDirectory,
  platform = process.platform,
) {
  return pathsFor(platform).join(applicationDirectory, "data");
}

export function belongsToService(target, baseUrl) {
  try {
    return new URL(target).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function localExecutable(
  resourcesDirectory,
  platform = process.platform,
) {
  const filename =
    platform === "win32" ? "solvemate-local.exe" : "solvemate-local";
  const paths = platform === "win32" ? win32 : posix;
  return paths.join(resourcesDirectory, "local", "solvemate-local", filename);
}

export function desktopEnvironment({
  resourcesDirectory,
  userDirectory,
  port,
}) {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    SOLVEMATE_USER_DIR: applicationDataDirectory(userDirectory),
    SOLVEMATE_BUNDLED_DATA: join(resourcesDirectory, "data"),
    SOLVEMATE_WEB_DIR: join(resourcesDirectory, "web"),
    SOLVEMATE_LOCAL_ORIGINS: `http://127.0.0.1:${port}`,
  };
}

export async function waitForService(
  baseUrl,
  exited,
  { timeout = 90000, request = fetch, lastProgress = () => 0 } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < Math.max(deadline, lastProgress() + timeout)) {
    const outcome = await Promise.race([
      exited.then((result) => ({ type: "exit", result })),
      request(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(1000),
        cache: "no-store",
      })
        .then(async (response) => ({
          type: "response",
          ok: response.ok,
          body: response.ok ? await response.json() : null,
        }))
        .catch(() => ({ type: "pending" })),
    ]);
    if (outcome.type === "exit") {
      const detail = outcome.result.signal ?? `code ${outcome.result.code}`;
      throw new Error(`本机服务在启动完成前退出（${detail}）。`);
    }
    if (
      outcome.type === "response" &&
      outcome.ok &&
      outcome.body?.service === "solvemate-local"
    )
      return;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error("本机服务在 90 秒内未能启动。");
}
