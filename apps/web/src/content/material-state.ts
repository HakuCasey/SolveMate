import type { ReadingSelection } from "@solvemate/contracts";
import type { ReleaseManifest, UpdateResponse } from "./contracts";
import { storedVersion, type ContentSnapshot } from "./storage";

function files(manifest: ReleaseManifest, kind: ReadingSelection["kind"]) {
  const kinds =
    kind === "questions"
      ? ["questions"]
      : ["textbook", "textbook-pdf", "textbook-pages"];
  return JSON.stringify(
    manifest.files
      .filter((file) => kinds.includes(file.kind))
      .map((file) => [file.kind, file.id, file.sha256])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

/** 更新状态按所选资料的文件判断，课程包的其他文件变化不改变这份资料。 */
export function materialState(
  snapshot: ContentSnapshot,
  courseId: string,
  kind: ReadingSelection["kind"],
  version: string | null,
  update?: UpdateResponse,
) {
  const head = storedVersion(snapshot, courseId);
  // 条目可保留旧版；查询仍需对应当前包指针或已经下载完成的同一最新版。
  update =
    update &&
    (update.current_version === head || update.latest.version === head)
      ? update
      : undefined;
  const saved = snapshot.installed.find(
    (item) => item.courseId === courseId && item.version === version,
  );
  const local = snapshot.allCourses.find(
    (item) => item.id === courseId && item.version === version,
  );
  const latestVersion =
    update?.latest.version ??
    snapshot.heads.find((item) => item.courseId === courseId)?.version;
  const cachedLatest = snapshot.installed.find(
    (item) =>
      item.courseId === courseId &&
      item.version === latestVersion &&
      item.available !== false,
  );
  const current =
    !!saved &&
    !!update &&
    files(saved.manifest, kind) === files(update.latest, kind);
  const unknown =
    update?.status === "unknown_version" &&
    update.current_version === version &&
    !current;
  return {
    saved,
    local,
    current,
    unknown,
    latestVersion,
    checked: !!update,
    updateAvailable: !!saved && !!update && !unknown && !current,
    canDownload: !!cachedLatest || (!!update && !unknown),
  };
}
