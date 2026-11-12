import type { UpdateResponse } from "./contracts";
import { storedVersion, type ContentSnapshot } from "./storage";

/** 只核对课程包的保存记录和版本；资料是否可读由 OfficialMaterial 判断。 */
export function courseState(
  snapshot: ContentSnapshot,
  id: string,
  update?: UpdateResponse,
) {
  const head = snapshot.heads.find((item) => item.courseId === id);
  const saved = snapshot.installed.find(
    (item) => item.courseId === id && item.version === head?.version,
  );
  const local = snapshot.activeCourses.find((item) => item.id === id);
  const matches = update?.current_version === storedVersion(snapshot, id);
  const current = !!saved && update?.latest.version === saved.version;
  const updateAvailable = matches && update?.status === "update_available";
  const unknown = matches && update?.status === "unknown_version";
  const firstDownload = matches && update?.status === "not_installed";
  return {
    saved,
    local,
    canDownload:
      firstDownload ||
      updateAvailable ||
      (!saved && matches && update?.status === "up_to_date"),
    current,
    updateAvailable,
    unknown,
  };
}
