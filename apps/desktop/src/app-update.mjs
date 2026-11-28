const repository = "https://github.com/HakuCasey/SolveMate";
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function newerMacInstaller(currentVersion, request = fetch) {
  const latest = `${repository}/releases/latest`;
  const response = await request(latest, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "Cache-Control": "no-cache" },
  });
  const location = response.headers.get("location");
  if (response.status !== 302 || !location)
    throw new Error("GitHub did not return a stable release.");
  const target = new URL(location, latest);
  const tag = target.pathname.split("/").at(-1);
  if (
    !stableTag.test(tag) ||
    target.href !== `${repository}/releases/tag/${tag}` ||
    !stableTag.test(`v${currentVersion}`)
  )
    throw new Error("Invalid GitHub release version.");
  const version = tag.slice(1);
  if (version.localeCompare(currentVersion, "en", { numeric: true }) <= 0)
    return null;
  // 发布任务用相同的版本和架构命名 DMG，下载固定版本。
  return `${repository}/releases/download/${tag}/SolveMate-${version}-arm64.dmg`;
}

export function macAppUpdate({
  version,
  publishState,
  downloadInstaller,
  request,
}) {
  let state = { status: "idle", error: "" };
  function publish(status, error = "") {
    state = { status, error };
    publishState(state);
  }

  return async (action) => {
    if (
      action !== "download" ||
      ["checking", "downloading"].includes(state.status)
    )
      return state;
    publish("checking");
    try {
      const url = await newerMacInstaller(version, request);
      if (!url) {
        publish("current");
        return state;
      }
      publish("downloading");
      const result = await downloadInstaller(url);
      if (result === "completed") publish("downloaded");
      else if (result === "cancelled") publish("idle");
      else publish("error", "安装包下载中断，请重试。");
    } catch (error) {
      const downloading = state.status === "downloading";
      console.error(
        downloading
          ? "Failed to download the Mac installer."
          : "Failed to check for Mac updates.",
        error,
      );
      publish(
        "error",
        downloading ? "安装包下载失败，请重试。" : "无法获取最新版本，请重试。",
      );
    }
    return state;
  };
}
