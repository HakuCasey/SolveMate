export function downloadStatisticsEndpoint(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    ) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

export async function recordInstallerDownload(
  endpoint,
  { version, target, source },
  request = fetch,
) {
  if (!endpoint) return;
  try {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ version, target, source }).toString();
    await request(url.href, {
      method: "POST",
      mode: "no-cors",
      credentials: "omit",
      keepalive: true,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // 下载统计与安装包请求独立。
  }
}
