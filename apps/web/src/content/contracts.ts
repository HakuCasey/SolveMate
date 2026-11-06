/** 与官方内容服务的 OpenAPI 对齐，读取外部数据时仍需校验。 */
export interface CourseInfo {
  id: string;
  title: string;
  description: string;
  release: string;
}
export interface RemoteCourse extends CourseInfo {
  latest_version: string;
  manifest_url: string;
  download_url: string;
}
export type ContentKind =
  "textbook" | "questions" | "learning-points" | "discussion-points";
export interface ContentFile {
  id: string;
  kind: ContentKind;
  path: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
}
export interface ReleaseManifest {
  schema_version: 1;
  course: CourseInfo;
  version: string;
  sha256: string;
  size_bytes: number;
  files: ContentFile[];
  download_url: string;
}
export interface UpdateResponse {
  course_id: string;
  current_version: string | null;
  status:
    "not_installed" | "up_to_date" | "update_available" | "unknown_version";
  update_available: boolean;
  latest: ReleaseManifest;
}
export class ContentError extends Error {}
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 20 * 1024 * 1024;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContentError("内容格式不正确。");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new ContentError("内容中缺少必要文字。");
  return value;
}
export function items(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ContentError("内容列表格式不正确。");
  return value;
}
export function digest(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new ContentError("内容校验信息不正确。");
  return result;
}
export function identifier(value: unknown): string {
  const result = text(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result))
    throw new ContentError("课程编号格式不正确。");
  return result;
}
export function info(value: unknown): CourseInfo {
  const data = record(value);
  return {
    id: identifier(data.id),
    title: text(data.title),
    description: text(data.description),
    release: text(data.release),
  };
}
export function safePath(value: unknown): string {
  const path = text(value);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ContentError("内容文件路径不正确。");
  return path;
}
export function size(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new ContentError("内容大小超出当前支持范围。");
  return value;
}
export function unique(values: string[]): void {
  if (new Set(values).size !== values.length)
    throw new ContentError("内容包含重复编号或文件。");
}
export function parseFiles(value: unknown): ContentFile[] {
  const files = items(value).map((value): ContentFile => {
    const file = record(value);
    const kind = text(file.kind);
    if (
      kind !== "textbook" &&
      kind !== "questions" &&
      kind !== "learning-points" &&
      kind !== "discussion-points"
    )
      throw new ContentError("暂不支持这种内容文件。");
    return {
      id: text(file.id),
      kind,
      path: safePath(file.path),
      media_type: text(file.media_type),
      size_bytes: size(file.size_bytes, MAX_CONTENT_BYTES),
      sha256: digest(file.sha256),
    };
  });
  if (
    files.length !== 4 ||
    new Set(files.map((file) => file.kind)).size !== 4 ||
    files.some((file) => file.path === "course.json") ||
    files.reduce((sum, file) => sum + file.size_bytes, 0) > MAX_CONTENT_BYTES
  )
    throw new ContentError("课程文件不完整或超出当前支持范围。");
  unique(files.map((file) => file.id));
  unique(files.map((file) => file.path));
  return files;
}
export function parseManifest(value: unknown): ReleaseManifest {
  const data = record(value);
  if (data.schema_version !== 1)
    throw new ContentError("暂不支持这个内容包版本。");
  const course = info(data.course),
    version = digest(data.version);
  const sha256 = digest(data.sha256),
    download_url = text(data.download_url);
  if (
    sha256 !== version ||
    download_url !== `/api/v1/courses/${course.id}/versions/${version}/download`
  )
    throw new ContentError("下载地址与内容版本不一致。");
  const size_bytes = size(data.size_bytes, MAX_PACKAGE_BYTES);
  if (!size_bytes) throw new ContentError("内容包不能为空。");
  return {
    schema_version: 1,
    course,
    version,
    sha256,
    download_url,
    size_bytes,
    files: parseFiles(data.files),
  };
}
export function parseCatalog(value: unknown): RemoteCourse[] {
  const data = record(value);
  if (data.schema_version !== 1)
    throw new ContentError("暂不支持这个内容目录版本。");
  const courses = items(data.courses).map((value): RemoteCourse => {
    const data = record(value),
      course = info(data),
      version = digest(data.latest_version);
    const manifest_url = text(data.manifest_url),
      download_url = text(data.download_url);
    if (
      manifest_url !== `/api/v1/courses/${course.id}/versions/${version}` ||
      download_url !== `${manifest_url}/download`
    )
      throw new ContentError("课程版本地址不正确。");
    return { ...course, latest_version: version, manifest_url, download_url };
  });
  unique(courses.map((course) => course.id));
  return courses;
}
export function parseUpdate(
  value: unknown,
  courseId: string,
  currentVersion: string | null,
): UpdateResponse {
  const data = record(value),
    latest = parseManifest(data.latest);
  const status = data.status;
  if (
    data.course_id !== courseId ||
    latest.course.id !== courseId ||
    data.current_version !== currentVersion ||
    (status !== "not_installed" &&
      status !== "up_to_date" &&
      status !== "update_available" &&
      status !== "unknown_version") ||
    data.update_available !==
      (status === "not_installed" || status === "update_available") ||
    (status === "up_to_date" && currentVersion !== latest.version) ||
    ((status === "update_available" || status === "unknown_version") &&
      (!currentVersion || currentVersion === latest.version)) ||
    (status === "not_installed" && currentVersion !== null)
  )
    throw new ContentError("版本查询结果不一致。");
  return {
    course_id: courseId,
    current_version: currentVersion,
    status,
    update_available: data.update_available,
    latest,
  };
}
