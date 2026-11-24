import { useSyncExternalStore } from "react";

/** 内置默认地址：源码版由 vite 代理到本机内容服务，桌面版由安装包侧配置。 */
export const DEFAULT_CONTENT_SERVICE_URL = "/api/v1";

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * 校验用户填写的内容服务地址。
 * 空值表示使用默认地址；站内相对路径必须以 / 开头；其它必须是 http(s) 绝对地址。
 */
export function contentServiceUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return null;
  } catch {
    // 继续走下面的统一提示。
  }
  return "请填写以 http:// 或 https:// 开头的完整地址，或以 / 开头的站内路径。";
}

/** 把用户填写值归一化为可保存的地址；空值返回 undefined，非法值也返回 undefined。 */
export function normalizeContentServiceUrl(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || contentServiceUrlError(trimmed)) return undefined;
  if (trimmed === "/") return DEFAULT_CONTENT_SERVICE_URL;
  return trimTrailingSlashes(trimmed);
}

/** 解析实际请求用的服务地址：用户配置 > 构建期默认 > 内置默认。 */
export function contentApiBase(configured?: string): string {
  const normalized = normalizeContentServiceUrl(configured);
  return (
    normalized || import.meta.env.VITE_CONTENT_API_URL || DEFAULT_CONTENT_SERVICE_URL
  );
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
