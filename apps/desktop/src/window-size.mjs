import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function initialWindowBounds(workArea, saved) {
  const minWidth = Math.min(1024, workArea.width);
  const minHeight = Math.min(680, workArea.height);
  const validSize =
    Number.isSafeInteger(saved?.width) &&
    saved.width > 0 &&
    Number.isSafeInteger(saved?.height) &&
    saved.height > 0;
  const width = Math.min(
    workArea.width,
    Math.max(minWidth, validSize ? saved.width : 1280),
  );
  const height = Math.min(
    workArea.height,
    Math.max(minHeight, validSize ? saved.height : 760),
  );
  return {
    width,
    height,
    minWidth,
    minHeight,
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
  };
}

export function readWindowSize(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      console.warn("Could not read window size.", error.message);
    return null;
  }
}

export function saveWindowSize(path, { width, height }) {
  try {
    writeFileSync(path + ".tmp", JSON.stringify({ width, height }), "utf8");
    renameSync(path + ".tmp", path);
  } catch (error) {
    console.warn("Could not save window size.", error.message);
  }
}
