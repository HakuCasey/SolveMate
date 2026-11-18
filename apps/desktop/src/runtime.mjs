import { join } from "node:path";

export const DESKTOP_PORT = 43127;

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
  return join(resourcesDirectory, "local", "solvemate-local", filename);
}

export function desktopEnvironment({
  resourcesDirectory,
  userDirectory,
  port,
}) {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    SOLVEMATE_USER_DIR: join(userDirectory, "data"),
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
