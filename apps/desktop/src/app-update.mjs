function prepareNativeInstall(nativeUpdater) {
  return new Promise((resolve, reject) => {
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = (error) => {
      cleanup();
      reject(error);
    };
    const notAvailable = () => failed(new Error("No macOS update was staged."));
    function cleanup() {
      nativeUpdater.off("update-downloaded", ready);
      nativeUpdater.off("error", failed);
      nativeUpdater.off("update-not-available", notAvailable);
    }
    nativeUpdater.on("update-downloaded", ready);
    nativeUpdater.on("error", failed);
    nativeUpdater.on("update-not-available", notAvailable);
    try {
      nativeUpdater.checkForUpdates();
    } catch (error) {
      failed(error);
    }
  });
}

/** 用户确认后才让原生更新器接收并检查已下载的 ZIP。 */
export function macAppUpdate(
  updater,
  nativeUpdater,
  { publishState, confirmInstall, flushStorage },
) {
  let state = { status: "idle", error: "" };
  let confirming = false;
  let nativeReady = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  function publish(status, error = "") {
    state = { status, error };
    publishState(state);
  }

  function installFailed(error) {
    console.error("Failed to install the macOS update.", error);
    publish("ready", "安装新版失败，请重试。");
  }
  // 查询、下载和签名检查返回 Promise；最终重启失败只通过事件返回。
  updater.on("error", (error) => {
    if (state.status === "reloading" && nativeReady) installFailed(error);
  });

  return async (action) => {
    if (
      action === "check" &&
      ["idle", "current", "error"].includes(state.status)
    ) {
      publish("checking");
      try {
        const result = await updater.checkForUpdates();
        if (!result) throw new Error("The macOS updater is disabled.");
        publish(result.isUpdateAvailable ? "available" : "current");
      } catch (error) {
        console.error("Failed to check for macOS updates.", error);
        publish("error", "检查更新失败，请检查网络后重试。");
      }
    } else if (action === "download" && state.status === "available") {
      publish("downloading");
      try {
        await updater.downloadUpdate();
        publish("ready");
      } catch (error) {
        console.error("Failed to download the macOS update.", error);
        publish("available", "下载新版失败，请重试。");
      }
    } else if (
      action === "install" &&
      state.status === "ready" &&
      !confirming
    ) {
      confirming = true;
      try {
        if (!(await confirmInstall())) return state;
        publish("reloading");
        // 单独等待签名检查，失败重试时不会重复登记库内的重启回调。
        if (!nativeReady) {
          await prepareNativeInstall(nativeUpdater);
          nativeReady = true;
        }
        flushStorage();
        updater.quitAndInstall();
      } catch (error) {
        installFailed(error);
      } finally {
        confirming = false;
      }
    }
    return state;
  };
}
