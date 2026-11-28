import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import { macAppUpdate, newerMacInstaller } from "../src/app-update.mjs";

const releases = "https://github.com/HakuCasey/SolveMate/releases";

function latest(version) {
  return async () =>
    new Response(null, {
      status: 302,
      headers: { location: `${releases}/tag/v${version}` },
    });
}

test("a click checks for a newer Mac release and downloads its fixed DMG", async () => {
  const states = [];
  const downloads = [];
  const update = macAppUpdate({
    version: "0.0.2",
    request: latest("0.0.10"),
    publishState: (state) => states.push(state.status),
    downloadInstaller: async (url) => {
      downloads.push(url);
      return "completed";
    },
  });
  assert.equal((await update("state")).status, "idle");
  assert.deepEqual(downloads, []);
  assert.equal((await update("download")).status, "downloaded");
  assert.deepEqual(states, ["checking", "downloading", "downloaded"]);
  assert.deepEqual(downloads, [
    `${releases}/download/v0.0.10/SolveMate-0.0.10-arm64.dmg`,
  ]);
});

test("same or older releases are not offered and redirects must match the repository", async () => {
  assert.equal(await newerMacInstaller("0.0.2", latest("0.0.2")), null);
  assert.equal(await newerMacInstaller("0.0.2", latest("0.0.1")), null);
  const invalid = async () =>
    new Response(null, {
      status: 302,
      headers: {
        location: "https://github.com/other/repo/releases/tag/v1.0.0",
      },
    });
  await assert.rejects(
    newerMacInstaller("0.0.2", invalid),
    /Invalid GitHub release/,
  );
});

test("a duplicate click does not start another download and retry works after interruption", async () => {
  let finish;
  const downloads = new EventEmitter();
  const update = macAppUpdate({
    version: "0.0.2",
    request: latest("0.0.3"),
    publishState: () => {},
    downloadInstaller: () =>
      new Promise((resolve) => {
        finish = resolve;
        downloads.emit("started");
      }),
  });
  const firstStarted = once(downloads, "started");
  const first = update("download");
  assert.equal((await update("download")).status, "checking");
  await firstStarted;
  assert.equal((await update("state")).status, "downloading");
  finish("interrupted");
  assert.equal((await first).status, "error");
  const retryStarted = once(downloads, "started");
  const retry = update("download");
  assert.equal((await update("download")).status, "checking");
  await retryStarted;
  finish("cancelled");
  assert.equal((await retry).status, "idle");
});
