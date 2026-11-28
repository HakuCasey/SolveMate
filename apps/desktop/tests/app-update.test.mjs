import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { desktopAppUpdate, newerDesktopInstaller } from "../src/app-update.mjs";

import { installerTarget } from "../src/installers.mjs";

const mac = installerTarget("darwin", "arm64");
const windows = installerTarget("win32", "x64");
const releases = "https://github.com/HakuCasey/SolveMate/releases";

function latest(version) {
  return async (_url, options) =>
    options.method === "HEAD"
      ? new Response(null)
      : Response.json({ [mac]: version });
}

test("checks for a newer Mac release before offering a separate download", async () => {
  const states = [];
  const downloads = [];
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.2",
    request: latest("0.0.10"),
    publishState: (state) => states.push(state.status),
    downloadInstaller: async (url) => {
      downloads.push(url);
      return {
        status: "completed",
        path: "/downloads/SolveMate-0.0.10-arm64.dmg",
      };
    },
  });
  assert.equal((await update("state")).status, "idle");
  assert.equal((await update("download")).status, "idle");
  assert.deepEqual(states, []);
  assert.deepEqual(await update("check"), {
    status: "available",
    error: "",
    installerVersion: "0.0.10",
  });
  assert.deepEqual(downloads, []);
  assert.equal((await update("download")).status, "downloaded");
  assert.deepEqual(states, [
    "checking",
    "available",
    "downloading",
    "downloaded",
  ]);
  assert.deepEqual(downloads, [
    `${releases}/download/v0.0.10/SolveMate-0.0.10-arm64.dmg`,
  ]);
});

test("opens or reveals the actual saved file and offers another download if it was removed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "solvemate-installer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "custom download.dmg");
  await writeFile(path, "installer fixture");
  const actions = [];
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.5",
    request: latest("0.0.6"),
    publishState: () => {},
    downloadInstaller: async () => ({ status: "completed", path }),
    openInstaller: (file) => {
      actions.push(["open", file]);
      return "";
    },
    revealInstaller: (file) => actions.push(["reveal", file]),
  });

  await update("open-installer");
  assert.deepEqual(actions, []);
  await update("check");
  assert.equal((await update("download")).installerFile.path, path);
  await update("open-installer", "/untrusted/path.dmg");
  await update("reveal-installer");
  assert.deepEqual(actions, [
    ["open", path],
    ["reveal", path],
  ]);
  await unlink(path);
  const missing = await update("reveal-installer");
  assert.equal(missing.status, "available");
  assert.match(missing.error, /找不到已下载的安装包/);
  assert.equal(actions.length, 2);
});

test("a check for the current release does not offer a download", async () => {
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.6",
    request: latest("0.0.6"),
    publishState: () => {},
    downloadInstaller: () =>
      assert.fail("An up-to-date installation cannot download"),
  });
  assert.equal((await update("check")).status, "current");
  assert.equal((await update("download")).status, "current");
});

test("reports real download progress when the installer size is known", async () => {
  const progress = [];
  let onProgress;
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.6",
    request: latest("0.0.7"),
    publishState: (state) => {
      if (state.downloadPercent !== undefined)
        progress.push(state.downloadPercent);
    },
    downloadInstaller: async (_url, receive) => {
      onProgress = receive;
      receive(20, 0);
      receive(42, 100);
      receive(425, 1000);
      receive(100, 100);
      return {
        status: "completed",
        path: "/downloads/SolveMate-0.0.7-arm64.dmg",
      };
    },
  });
  await update("check");
  const downloaded = await update("download");
  onProgress(100, 100);
  assert.deepEqual(progress, [42, 100]);
  assert.equal(downloaded.status, "downloaded");
  assert.equal((await update("state")).downloadPercent, undefined);
});

test("cancels the active download and keeps the found version available", async () => {
  let signal;
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.6",
    request: latest("0.0.7"),
    publishState: () => {},
    downloadInstaller: (_url, report, currentSignal) => {
      signal = currentSignal;
      report(20, 100);
      return new Promise((resolve) => {
        currentSignal.addEventListener(
          "abort",
          () => resolve({ status: "cancelled" }),
          { once: true },
        );
      });
    },
  });
  await update("check");
  const download = update("download");
  assert.equal((await update("state")).downloadPercent, 20);
  await update("cancel-download");
  assert(signal.aborted);
  assert.deepEqual(await download, {
    status: "available",
    error: "",
    installerVersion: "0.0.7",
  });
});

test("same or older releases do not offer an installer", async () => {
  assert.equal(
    await newerDesktopInstaller("0.0.2", mac, latest("0.0.2")),
    null,
  );
  assert.equal(
    await newerDesktopInstaller("0.0.2", mac, latest("0.0.1")),
    null,
  );
});

test("chooses the installer published for the current system", async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push([url, options.method]);
    return options.method === "HEAD"
      ? new Response(null)
      : Response.json({ [mac]: "0.0.12", [windows]: "0.0.8" });
  };
  const url = `${releases}/download/v0.0.8/SolveMate-0.0.8-x64-Setup.exe`;
  assert.deepEqual(await newerDesktopInstaller("0.0.1", windows, request), {
    version: "0.0.8",
    url,
  });
  assert.deepEqual(requests, [
    ["https://hakucasey.github.io/SolveMate/downloads.json", undefined],
    [url, "HEAD"],
  ]);
  assert.equal(installerTarget("win32", "arm64"), null);
});

test("reports a missing, malformed, or unavailable published installer", async () => {
  const missing = async () => Response.json({ [mac]: "0.0.12" });
  await assert.rejects(
    newerDesktopInstaller("0.0.1", windows, missing),
    /Invalid desktop installer/,
  );
  const invalid = async () => Response.json({ [windows]: "../../somewhere" });
  await assert.rejects(
    newerDesktopInstaller("0.0.1", windows, invalid),
    /Invalid desktop installer/,
  );
  const unavailable = async (_url, options) =>
    options.method === "HEAD"
      ? new Response(null, { status: 404 })
      : Response.json({ [windows]: "0.0.2" });
  await assert.rejects(
    newerDesktopInstaller("0.0.1", windows, unavailable),
    /not available/,
  );
});

test("a duplicate click does not start another download and retry works after interruption", async () => {
  let finish;
  const downloads = new EventEmitter();
  const update = desktopAppUpdate({
    target: mac,
    version: "0.0.2",
    request: latest("0.0.3"),
    publishState: () => {},
    downloadInstaller: () =>
      new Promise((resolve) => {
        finish = resolve;
        downloads.emit("started");
      }),
  });
  await update("check");
  const firstStarted = once(downloads, "started");
  const first = update("download");
  assert.equal((await update("download")).status, "downloading");
  await firstStarted;
  assert.equal((await update("state")).status, "downloading");
  finish({ status: "interrupted" });
  assert.match((await first).error, /下载中断/);
  assert.equal((await update("state")).status, "available");
  const retryStarted = once(downloads, "started");
  const retry = update("download");
  assert.equal((await update("download")).status, "downloading");
  await retryStarted;
  finish({ status: "cancelled" });
  assert.equal((await retry).status, "available");
  assert.equal((await update("state")).error, "");
});
