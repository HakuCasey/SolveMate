import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  initialWindowBounds,
  readWindowSize,
  saveWindowSize,
} from "../src/window-size.mjs";

const workArea = { x: -1600, y: 32, width: 1600, height: 900 };

test("centers the first window and restores the last saved size", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "solvemate-window-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "window-size.json");
  const launch = () => initialWindowBounds(workArea, readWindowSize(file));
  assert.deepEqual(launch(), {
    x: -1440,
    y: 102,
    width: 1280,
    height: 760,
    minWidth: 1024,
    minHeight: 680,
  });
  saveWindowSize(file, { width: 1184, height: 704 });
  assert.deepEqual(launch(), {
    x: -1392,
    y: 130,
    width: 1184,
    height: 704,
    minWidth: 1024,
    minHeight: 680,
  });
});

test("fits both initial and restored windows inside a small work area", () => {
  const small = { x: 12, y: 40, width: 960, height: 640 };
  for (const saved of [null, { width: 1500, height: 1000 }]) {
    assert.deepEqual(initialWindowBounds(small, saved), {
      ...small,
      minWidth: 960,
      minHeight: 640,
    });
  }
});
