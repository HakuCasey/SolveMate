import { defineConfig, type Plugin } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { defaultTheme } from "./src/theme/default";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PDF 字符映射、字体与解码器随应用分发，离线阅读不请求 CDN。
function pdfAssets(): Plugin {
  const root = dirname(
    createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  const files = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    for (const name of readdirSync(join(root, directory))) {
      if (!name.toLowerCase().includes("license") && !name.endsWith(".map"))
        files.set(`pdfjs/${directory}/${name}`, join(root, directory, name));
    }
  }
  return {
    name: "solvemate-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files.get(
          (request.url ?? "").split("?")[0].replace(/^\//, ""),
        );
        if (!file) return next();
        response.setHeader(
          "Content-Type",
          file.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
        );
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, source] of files)
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(source),
        });
    },
  };
}

export default defineConfig({
  server: {
    proxy: {
      "/api/v1": "http://127.0.0.1:8000",
      "/local-api": "http://127.0.0.1:8765",
    },
  },
  preview: {
    proxy: {
      "/api/v1": "http://127.0.0.1:8000",
      "/local-api": "http://127.0.0.1:8765",
    },
  },
  plugins: [
    react(),
    pdfAssets(),
    VitePWA({
      registerType: "prompt",
      // 注册、检测与重载由应用统一控制，避免生成脚本重复注册。
      injectRegister: false,
      includeAssets: [
        "icon.svg",
        "icon-192.png",
        "icon-512.png",
        "LICENSE.txt",
        "third-party-licenses.txt",
      ],
      manifest: {
        name: "SolveMate",
        short_name: "SolveMate",
        description: "教材与题目阅读、本地笔记和学习对话。",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: defaultTheme.colors.light.accent,
        background_color: defaultTheme.colors.light.background,
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        // 教材、题库及公式字体随应用缓存，离线启动不依赖外部字体服务。
        globPatterns: [
          "**/*.{js,mjs,css,html,svg,png,jpg,pdf,woff,woff2,ttf,bcmap,pfb,bin,wasm}",
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/local-api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
              priority: 30,
            },
            { name: "math", test: /node_modules\/katex\//, priority: 20 },
            {
              name: "ui",
              test: /node_modules\/(@radix-ui|radix-ui|lucide-react)\//,
              priority: 20,
            },
            { name: "storage", test: /node_modules\/dexie\//, priority: 20 },
          ],
        },
      },
    },
  },
});
