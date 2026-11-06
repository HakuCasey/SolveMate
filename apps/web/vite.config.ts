import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: { proxy: { "/api/v1": "http://127.0.0.1:8000" } },
  preview: { proxy: { "/api/v1": "http://127.0.0.1:8000" } },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
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
        theme_color: "#5551da",
        background_color: "#f5f6fa",
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
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,ttf}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
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
