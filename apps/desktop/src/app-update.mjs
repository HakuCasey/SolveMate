import { stat } from "node:fs/promises";
import { parse } from "node:path";
import { desktopInstaller } from "./installers.mjs";

const downloadsURL = "https://hakucasey.github.io/SolveMate/downloads.json";

export async function newerDesktopInstaller(
  currentVersion,
  target,
  request = fetch,
) {
  const signal = AbortSignal.timeout(15_000);
  const response = await request(downloadsURL, {
    redirect: "error",
    signal,
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok)
    throw new Error("Could not read the published desktop versions.");
  const versions = await response.json();
  const installer = desktopInstaller(target, versions?.[target]);
  if (
    installer.version.localeCompare(currentVersion, "en", { numeric: true }) <=
    0
  )
    return null;
  const asset = await request(installer.url, { method: "HEAD", signal });
  if (!asset.ok) throw new Error("The listed installer is not available.");
  return installer;
}

export function desktopAppUpdate({
  version,
  target,
  publishState,
  downloadInstaller,
  openInstaller,
  revealInstaller,
  request,
}) {
  let state = { status: "idle", error: "" };
  let installer = null;
  let activeDownload = null;
  function publish(status, error = "", installerFile) {
    state = {
      status,
      error,
      ...(installer && { installerVersion: installer.version }),
      ...(installerFile && { installerFile }),
    };
    publishState(state);
  }

  async function useDownloadedInstaller(action) {
    const { installerFile } = state;
    const file = await stat(installerFile.path).catch(() => null);
    if (!file?.isFile()) {
      publish("available", "找不到已下载的安装包。");
      return;
    }
    try {
      if (action === "reveal-installer") {
        await revealInstaller(installerFile.path);
      } else {
        const error = await openInstaller(installerFile.path);
        if (error) throw new Error(error);
      }
      if (state.error) publish("downloaded", "", installerFile);
    } catch (error) {
      console.error(
        "Failed to open or reveal the downloaded installer.",
        error,
      );
      const message =
        action === "open-installer"
          ? "无法打开安装包，请在文件夹中双击打开。"
          : "无法打开安装包所在的文件夹。";
      publish("downloaded", message, installerFile);
    }
  }

  async function check() {
    publish("checking");
    try {
      installer = await newerDesktopInstaller(version, target, request);
      publish(installer ? "available" : "current");
    } catch (error) {
      console.error("Failed to check for desktop updates.", error);
      publish("error", "无法获取最新版本，请重试。");
    }
  }

  async function download() {
    const controller = new AbortController();
    activeDownload = controller;
    publish("downloading");
    try {
      const { status, path } = await downloadInstaller(
        installer.url,
        (received, total) => {
          if (
            activeDownload !== controller ||
            controller.signal.aborted ||
            total <= 0
          )
            return;
          const downloadPercent = Math.min(
            100,
            Math.floor((received / total) * 100),
          );
          if (downloadPercent === state.downloadPercent) return;
          state = { ...state, downloadPercent };
          publishState(state);
        },
        controller.signal,
      );
      if (status === "completed" && path) {
        const { base: name, dir: directory } = parse(path);
        publish("downloaded", "", { path, name, directory });
      } else if (status === "cancelled") publish("available");
      else publish("available", "安装包下载中断，请重试。");
    } catch (error) {
      console.error("Failed to download the installer.", error);
      publish("available", "安装包下载失败，请重试。");
    } finally {
      activeDownload = null;
    }
  }

  return async (action) => {
    if (
      action === "check" &&
      ["idle", "current", "error"].includes(state.status)
    ) {
      await check();
    } else if (action === "download" && state.status === "available") {
      await download();
    } else if (action === "cancel-download" && state.status === "downloading") {
      activeDownload?.abort();
    } else if (
      state.status === "downloaded" &&
      (action === "open-installer" || action === "reveal-installer")
    ) {
      await useDownloadedInstaller(action);
    }
    return state;
  };
}
