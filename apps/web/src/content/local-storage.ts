import { dataRefresh } from "../refresh/coordinator";
import {
  ContentConflictError,
  ContentStorage,
  makeSnapshot,
  type SavedCourse,
  type CourseHead,
  type InstalledCourse,
} from "./storage";
import { parseManifest, ContentError, type ReleaseManifest } from "./contracts";
import { readPackage } from "./package";
import { logError } from "../logger";
import {
  ensureUserStorage,
  localRequest,
  LocalServiceError,
  userCache,
  remember,
  toBase64,
} from "../storage/local-service";

/** 下载内容的正式副本和版本指针保存在本机；浏览器副本只用于缓存阅读。 */
export class LocalContentStorage {
  async load() {
    await ensureUserStorage();
    let records: SavedCourse[], heads: CourseHead[];
    try {
      const result = (await (await localRequest("/content")).json()) as {
        versions: (Omit<SavedCourse, "archive"> & { available?: boolean })[];
        heads: CourseHead[];
      };
      if (!Array.isArray(result.versions) || !Array.isArray(result.heads))
        throw new ContentError("本机课程记录格式不正确，原有内容已保留。");
      const missing: string[] = [];
      const loaded = await Promise.all(
        result.versions.map(async (item) => {
          try {
            const manifest = parseManifest(item.manifest);
            if (
              manifest.course.id !== item.courseId ||
              manifest.version !== item.version
            )
              throw new ContentError("课程版本与清单不一致。");
            const cached = await userCache
              .get<SavedCourse>(`package:${item.courseId}:${item.version}`)
              .catch(() => undefined);
            let archive: Uint8Array | undefined;
            if (cached?.manifest.sha256 === manifest.sha256) {
              try {
                await readPackage(manifest, cached.archive);
                archive = cached.archive;
              } catch (error) {
                logError(
                  "Cached course failed validation; reading its local copy.",
                  error,
                );
              }
            }
            if (item.available === false) {
              missing.push(manifest.course.title);
              if (!archive) return null;
            }
            archive ??= new Uint8Array(
              await (
                await localRequest(
                  `/content/${encodeURIComponent(item.courseId)}/${encodeURIComponent(item.version)}`,
                )
              ).arrayBuffer(),
            );
            const saved = { ...item, manifest, archive };
            await readPackage(manifest, archive);
            await remember(`package:${item.courseId}:${item.version}`, saved);
            return saved;
          } catch (error) {
            if (
              error instanceof LocalServiceError &&
              (error.code === "unavailable" || error.status >= 500)
            )
              throw error;
            logError(
              "Failed to read a saved course package; retaining other courses.",
              error,
            );
            missing.push(item.manifest?.course?.title ?? item.courseId);
            return null;
          }
        }),
      );
      records = loaded.filter(
        (item): item is NonNullable<typeof item> => item !== null,
      );
      heads = result.heads.filter((head) =>
        records.some(
          (item) =>
            item.courseId === head.courseId && item.version === head.version,
        ),
      );
      dataRefresh.reportIssue(
        "content",
        missing.length
          ? `${[...new Set(missing)].join("、")}的课程文件缺失或无法读取，请恢复文件或重新下载；已有缓存仍保留。`
          : "",
      );
      await remember("content", { records, heads });
    } catch (error) {
      if (
        !(error instanceof LocalServiceError) ||
        (error.code !== "unavailable" && error.status < 500)
      )
        throw error;
      const cached = await userCache.get<{
        records: SavedCourse[];
        heads: CourseHead[];
      }>("content");
      if (!cached) {
        // 初次迁移尚未连接服务时，允许只读原来的课程缓存。
        return new ContentStorage().load();
      }
      ({ records, heads } = cached);
    }
    const installed = await Promise.all(
      records.map(async (item) => ({
        ...item,
        course: await readPackage(item.manifest, item.archive),
      })),
    );
    return makeSnapshot(installed, heads);
  }
  async install(
    manifest: ReleaseManifest,
    archive: Uint8Array,
    expectedVersion: string | null,
    signal?: AbortSignal,
    onSaving?: () => void,
  ): Promise<InstalledCourse> {
    const verified = parseManifest(manifest);
    const bytes = new Uint8Array(archive);
    const course = await readPackage(verified, bytes, signal);
    signal?.throwIfAborted();
    const saved: SavedCourse = {
      courseId: course.id,
      version: course.version,
      manifest: verified,
      archive: bytes,
      installedAt: Date.now(),
    };
    onSaving?.();
    try {
      await localRequest("/content", {
        method: "PUT",
        body: JSON.stringify({
          manifest: verified,
          archive: toBase64(bytes),
          installedAt: saved.installedAt,
          expectedVersion,
        }),
      });
    } catch (error) {
      if (
        error instanceof LocalServiceError &&
        error.code === "content_conflict"
      )
        throw new ContentConflictError();
      if (
        error instanceof LocalServiceError &&
        (error.code === "unavailable" || error.status >= 500)
      ) {
        // 响应丢失不代表事务失败；重新核对指针，不能把已保存的课程报成失败。
        let confirmed = false;
        try {
          const current = (await (await localRequest("/content")).json()) as {
            heads: CourseHead[];
          };
          confirmed = current.heads.some(
            (head) =>
              head.courseId === course.id && head.version === course.version,
          );
        } catch {
          /* 不能确认结果时保留旧版缓存，交由用户恢复连接后重新读取。 */
        }
        if (!confirmed)
          throw new ContentError(
            "未能确认课程是否已保存。原有版本文件仍保留，请恢复本机服务后重新读取课程。",
          );
      } else
        throw new ContentError(
          error instanceof Error
            ? error.message
            : "本机课程保存失败，原有版本已保留。",
        );
    }
    await remember(`package:${course.id}:${course.version}`, saved);
    // 重新读取服务端指针，避免另一浏览器同期安装的其他课程被旧列表覆盖。
    const cached = await userCache
      .get<{ records: SavedCourse[]; heads: CourseHead[] }>("content")
      .catch(() => undefined);
    await remember("content", {
      records: [
        ...(cached?.records ?? []).filter(
          (item) =>
            item.courseId !== saved.courseId || item.version !== saved.version,
        ),
        saved,
      ],
      heads: [
        ...(cached?.heads ?? []).filter(
          (item) => item.courseId !== saved.courseId,
        ),
        { courseId: saved.courseId, version: saved.version },
      ],
    });
    await this.load().catch((error: unknown) =>
      logError("Course saved but cache refresh failed.", error),
    );
    return { ...saved, course };
  }
}
export const contentStorage = new LocalContentStorage();
