import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { macAppUpdate } from "../src/app-update.mjs";

function fixture(confirm = async () => true) {
  const states = [];
  const calls = [];
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => ({ isUpdateAvailable: true }),
    downloadUpdate: async () => calls.push("download"),
    quitAndInstall: () => calls.push("install"),
  });
  const nativeUpdater = Object.assign(new EventEmitter(), {
    checkForUpdates() {
      calls.push("stage");
      this.emit("update-downloaded");
    },
  });
  const update = macAppUpdate(updater, nativeUpdater, {
    publishState: (next) => states.push(next.status),
    confirmInstall: confirm,
    flushStorage: () => calls.push("flush"),
  });
  return { update, updater, nativeUpdater, states, calls };
}

test("checking, downloading and restarting require separate user actions", async () => {
  let confirmed = false;
  const { update, updater, states, calls } = fixture(async () => confirmed);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await update("download");
  await update("install");
  assert.deepEqual(calls, []);
  await update("check");
  await update("install");
  assert.deepEqual(calls, []);
  await update("download");
  await update("install");
  assert.deepEqual(calls, ["download"]);
  assert.equal((await update("state")).status, "ready");
  confirmed = true;
  await update("install");
  await update("install");
  assert.deepEqual(calls, ["download", "stage", "flush", "install"]);
  assert.deepEqual(states, [
    "checking",
    "available",
    "downloading",
    "ready",
    "reloading",
  ]);
});

test("duplicate clicks share the active step and a failed operation remains retryable", async (t) => {
  t.mock.method(console, "error", () => {});
  const { update, updater, nativeUpdater, calls } = fixture();
  const check = t.mock.method(updater, "checkForUpdates", async () => null);
  assert.equal((await update("check")).status, "error");
  check.mock.restore();
  await update("check");
  const download = t.mock.method(updater, "downloadUpdate", async () => {
    throw new Error("Download failed.");
  });
  const first = update("download");
  assert.equal((await update("download")).status, "downloading");
  assert.equal((await first).status, "available");
  assert.equal(download.mock.callCount(), 1);
  download.mock.restore();
  await update("download");
  const stage = t.mock.method(nativeUpdater, "checkForUpdates", () => {
    nativeUpdater.emit("error", new Error("Native package validation failed."));
  });
  assert.equal((await update("install")).status, "ready");
  assert.equal(nativeUpdater.listenerCount("update-downloaded"), 0);
  assert.deepEqual(calls, ["download"]);
  stage.mock.restore();
  await update("install");
  updater.emit("error", new Error("Native restart failed."));
  assert.equal((await update("state")).status, "ready");
  await update("install");
  assert.deepEqual(calls, [
    "download",
    "stage",
    "flush",
    "install",
    "flush",
    "install",
  ]);
});
