import { desktopInstaller } from "../desktop/src/installers.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/download")
      return new Response(null, { status: 404 });
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });

    const version = url.searchParams.get("version");
    const target = url.searchParams.get("target");
    const source = url.searchParams.get("source");
    if (
      !version ||
      version.length > 32 ||
      (source !== "website" && source !== "app-update")
    ) {
      return new Response(null, { status: 400 });
    }
    try {
      desktopInstaller(target, version);
    } catch {
      return new Response(null, { status: 400 });
    }

    // 同一个平台、版本和入口的并发请求在数据库里累加。
    await env.DOWNLOADS.prepare(
      `INSERT INTO download_counts (version, target, source, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (version, target, source) DO UPDATE SET count = count + 1`,
    )
      .bind(version, target, source)
      .run();
    return new Response(null, { status: 204 });
  },
};
