import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, screen, shell } from "electron";
import {
  initialWindowBounds,
  readWindowSize,
  saveWindowSize,
} from "./window-size.mjs";
import {
  DESKTOP_PORT,
  belongsToService,
  desktopEnvironment,
  localExecutable,
  waitForService,
} from "./runtime.mjs";

app.setName("SolveMate");
// 网页缓存和用户数据分开：缓存放本机临时目录（更新/排错可直接清），
// 数据放漫游目录（升级、卸载默认保留）。
const cacheRoot =
  process.platform === "win32"
    ? process.env.LOCALAPPDATA || app.getPath("userData")
    : process.platform === "darwin"
      ? join(app.getPath("home"), "Library", "Caches")
      : app.getPath("temp");
app.setPath("sessionData", join(cacheRoot, "SolveMate"));
console.info("Desktop main process loaded.");

const hasLock = app.requestSingleInstanceLock();

let mainWindow = null;
let localService = null;
let stopping = false;
let recovering = false;
const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resourcesDirectory() {
  return app.isPackaged
    ? process.resourcesPath
    : join(desktopDirectory, "resources");
}

function serviceUrl() {
  return `http://127.0.0.1:${DESKTOP_PORT}`;
}

async function requirePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(
      { host: "127.0.0.1", port: DESKTOP_PORT, exclusive: true },
      accept,
    );
  });
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
}

function processResult(child) {
  return new Promise((accept) => {
    child.once("error", (error) => accept({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => accept({ code, signal, error: null }));
    if (child.exitCode !== null || child.signalCode !== null)
      accept({
        code: child.exitCode,
        signal: child.signalCode,
        error: null,
      });
  });
}

async function startLocalService() {
  console.info("Starting desktop local service.");
  await requirePort().catch((error) => {
    throw new Error(
      `本机端口 ${DESKTOP_PORT} 已被占用，请关闭仍在运行的 SolveMate 或其他占用该端口的程序后重试。`,
      { cause: error },
    );
  });
  const logs = app.getPath("logs");
  await mkdir(logs, { recursive: true });
  const output = await open(join(logs, "desktop-service.log"), "a");
  const resources = resourcesDirectory();
  const executable = localExecutable(resources);
  const userDirectory =
    process.env.SOLVEMATE_DESKTOP_USER_DIR || app.getPath("userData");
  let child;
  try {
    child = spawn(
      executable,
      ["--port", String(DESKTOP_PORT), "--parent-pid", String(process.pid)],
      {
        env: desktopEnvironment({
          resourcesDirectory: resources,
          userDirectory,
          port: DESKTOP_PORT,
        }),
        stdio: ["ignore", "pipe", output.fd],
        windowsHide: true,
      },
    );
  } finally {
    await output.close();
  }
  let progressAt = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line === "data-copy-progress") progressAt = Date.now();
    else console.info(line);
  });
  const exited = processResult(child);
  try {
    await waitForService(serviceUrl(), exited, {
      lastProgress: () => progressAt,
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  console.info("Desktop local service is ready.");
  localService = { child, exited };
  void exited.then((result) => {
    if (localService?.child === child) localService = null;
    if (!stopping && !result.error) void recoverLocalService();
    if (!stopping && result.error)
      void recoverLocalService(result.error.message);
  });
}

async function startWithPrompt() {
  while (!localService) {
    try {
      await startLocalService();
      return true;
    } catch (error) {
      console.error("Desktop local service failed to start.", error);
      const result = await dialog.showMessageBox({
        type: "error",
        title: "SolveMate 启动失败",
        message: "本机服务未能启动",
        detail:
          error instanceof Error ? error.message : "请重新启动应用后再试。",
        buttons: ["重试", "退出"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 1) return false;
    }
  }
  return true;
}

async function recoverLocalService(detail = "本机服务意外停止。") {
  if (recovering || stopping) return;
  recovering = true;
  const result = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "error",
    title: "本机服务已停止",
    message: "资料和记录仍保存在电脑中",
    detail,
    buttons: ["重新启动", "退出"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    try {
      await startLocalService();
      await mainWindow?.loadURL(serviceUrl());
      recovering = false;
      return;
    } catch (error) {
      recovering = false;
      return recoverLocalService(
        error instanceof Error ? error.message : "本机服务重新启动失败。",
      );
    }
  }
  recovering = false;
  app.quit();
}

async function createMainWindow() {
  const sizePath = join(app.getPath("userData"), "window-size.json");
  const bounds = initialWindowBounds(
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
    readWindowSize(sizePath),
  );
  const window = new BrowserWindow({
    ...bounds,
    title: "SolveMate",
    icon:
      process.platform === "win32"
        ? join(
            app.isPackaged
              ? process.resourcesPath
              : join(desktopDirectory, "assets"),
            "icon.ico",
          )
        : join(resourcesDirectory(), "icon.png"),
    backgroundColor: "#f7f7fb",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://"))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (belongsToService(url, serviceUrl())) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://"))
      void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  let lastSize = bounds;
  window.on("close", (event) => {
    const size = window.getNormalBounds();
    // 仅因小屏而缩小的窗口，不覆盖用户在大屏上选定的尺寸。
    if (size.width !== lastSize.width || size.height !== lastSize.height) {
      saveWindowSize(sizePath, size);
      lastSize = size;
    }
    if (process.platform === "darwin" && !stopping) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  await window.loadFile(join(resourcesDirectory(), "startup.html"));
  return window;
}

async function openMainWindow() {
  const window = await createMainWindow();
  if (localService || (await startWithPrompt())) {
    await window.loadURL(serviceUrl());
    return;
  }
  app.quit();
}

function showMainWindow() {
  if (!mainWindow) {
    if (app.isReady() && !stopping) void openMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.on("second-instance", showMainWindow);
app.on("activate", showMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopping = true;
});

if (!hasLock) {
  app.quit();
} else {
  // Electron 会在主模块加载完成后进入 ready。这里注册回调，不能在模块顶层等待，
  // 否则主模块和 ready 事件会互相等待，应用只能停留在启动状态。
  void app
    .whenReady()
    .then(() => {
      console.info("Desktop application is ready.");
      return openMainWindow();
    })
    .catch((error) => {
      console.error("Desktop startup failed.", error);
      dialog.showErrorBox(
        "SolveMate 启动失败",
        error instanceof Error ? error.message : "本机应用未能完成启动。",
      );
      app.quit();
    });
}
