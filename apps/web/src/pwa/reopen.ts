const reopenParameter = "__solvemate_reopen";

/** 启动失败时直接读取网页服务；只解除本应用的旧 Worker，不清理任何数据。 */
export async function reopenApplication(): Promise<void> {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  const destination = new URL(base);
  destination.searchParams.set(reopenParameter, crypto.randomUUID());
  let response: Response;
  try {
    // 普通 fetch 不走导航回退；独立参数避免命中旧的预缓存和 HTTP 缓存。
    response = await fetch(destination, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (
      !response.ok ||
      !/text\/html/i.test(response.headers.get("content-type") ?? "")
    )
      throw new Error("Application page is unavailable.");
    await response.text();
  } catch {
    throw new Error(
      "无法获取当前网页版本，请在项目目录运行 npm start 后重试。原记录未修改。",
    );
  }
  if ("serviceWorker" in navigator) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const detach = async () => {
        const registration = await navigator.serviceWorker.getRegistration(
          base.href,
        );
        if (
          registration &&
          (registration.scope !== base.href ||
            !(await registration.unregister()))
        )
          throw new Error("Application worker could not be unregistered.");
      };
      await Promise.race([
        detach(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Application worker detach timed out.")),
            10000,
          );
        }),
      ]);
    } catch {
      throw new Error(
        "暂时无法退出旧版网页，请再次点击“更新并重新打开”。原记录未修改。",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  window.location.replace(destination.href);
}

/** 新脚本已载入后移除内部参数，不改变用户的其他参数或浏览历史。 */
export function clearReopenParameter(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(reopenParameter)) return;
  url.searchParams.delete(reopenParameter);
  window.history.replaceState(window.history.state, "", url.href);
}
