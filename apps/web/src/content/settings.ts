import { useSyncExternalStore } from "react";

/** 桌面安装包默认读取公开目录，源码启动仍可使用本地发布目录。 */
export const DEFAULT_CONTENT_SERVICE_URL =
  import.meta.env.VITE_CONTENT_API_URL ||
  (import.meta.env.VITE_DESKTOP === "1"
    ? "https://hakucasey.github.io/SolveMate/community"
    : "http://127.0.0.1:8000/api/v1");

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * 校验用户填写的内容服务地址。
 * 空值表示使用默认地址；其它值必须是完整的 http(s) 地址。
 */
export function contentServiceUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) return "内容服务地址不能超过 2048 个字符。";
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    ) {
      return null;
    }
  } catch {
    // 继续走下面的统一提示。
  }
  return "请填写以 http:// 或 https:// 开头的完整地址，不要包含账号、参数或锚点。";
}

/** 把用户填写值归一化为可保存的地址；空值返回 undefined，非法值也返回 undefined。 */
export function normalizeContentServiceUrl(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || contentServiceUrlError(trimmed)) return undefined;
  return trimTrailingSlashes(trimmed);
}

/** 解析实际请求用的服务地址：用户配置优先，否则使用当前构建的默认地址。 */
export function contentApiBase(configured?: string): string {
  const normalized = normalizeContentServiceUrl(configured);
  return normalized || DEFAULT_CONTENT_SERVICE_URL;
}

/**
 * 内容服务地址的运行时存储。
 * 页面数据在加载完成前就要创建内容接口，因此不再从设置对象里层层传递，
 * 由设置页写入、内容接口订阅。
 */
let current: string | undefined;
const listeners = new Set<() => void>();

export function getContentServiceUrl() {
  return current;
}

export function setContentServiceUrl(value: string | undefined) {
  const next = normalizeContentServiceUrl(value);
  if (next === current) return;
  current = next;
  for (const listen of listeners) listen();
}

export function subscribeContentServiceUrl(listen: () => void) {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

export function useContentServiceUrl() {
  return useSyncExternalStore(
    subscribeContentServiceUrl,
    getContentServiceUrl,
    () => undefined,
  );
}
