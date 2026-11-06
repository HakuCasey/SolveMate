import {
  ContentError,
  MAX_PACKAGE_BYTES,
  parseCatalog,
  parseUpdate,
  type ReleaseManifest,
} from "./contracts";

/** 请求仅发送公开课程编号与版本，不携带浏览器凭据或学习记录。 */
export class ContentApi {
  constructor(
    private base = import.meta.env.VITE_CONTENT_API_URL || "/api/v1",
  ) {}
  private async bytes(
    path: string,
    limit: number,
    signal?: AbortSignal,
    onProgress?: (received: number) => void,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException("Content request timed out.", "TimeoutError"),
        ),
      30_000,
    );
    try {
      const response = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-cache",
        redirect: "error",
      });
      if (!response.ok)
        throw new ContentError(
          response.status === 503
            ? "官方内容暂时不可用，请稍后重试。"
            : "无法获取官方内容，请稍后重试。",
        );
      const declared = response.headers.get("Content-Length");
      if (declared && Number(declared) > limit)
        throw new ContentError("内容超过当前支持的大小。");
      if (!response.body) throw new ContentError("没有收到完整的内容数据。");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > limit)
            throw new ContentError("内容大小与清单不一致。");
          chunks.push(value);
          onProgress?.(received);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
  private async json(path: string, signal?: AbortSignal): Promise<unknown> {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await this.bytes(path, 512 * 1024, signal),
      ),
    );
  }
  async catalog(signal?: AbortSignal) {
    return parseCatalog(await this.json("/courses", signal));
  }
  async update(
    courseId: string,
    currentVersion: string | null,
    signal?: AbortSignal,
  ) {
    const query = currentVersion
      ? `?current_version=${encodeURIComponent(currentVersion)}`
      : "";
    return parseUpdate(
      await this.json(
        `/courses/${encodeURIComponent(courseId)}/updates${query}`,
        signal,
      ),
      courseId,
      currentVersion,
    );
  }
  async download(
    manifest: ReleaseManifest,
    signal?: AbortSignal,
    progress?: (received: number) => void,
  ) {
    const bytes = await this.bytes(
      `/courses/${encodeURIComponent(manifest.course.id)}/versions/${manifest.version}/download`,
      Math.min(manifest.size_bytes, MAX_PACKAGE_BYTES),
      signal,
      progress,
    );
    if (bytes.length !== manifest.size_bytes)
      throw new ContentError("下载未完成，原有内容未被替换。");
    return bytes;
  }
}
