import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 检查锁定文件中的所有可选平台包，不依赖本机恰好安装了哪一个二进制包。
test("license notices include locked canvas packages for every platform", () => {
  const root = new URL("../", import.meta.url);
  const lock = JSON.parse(
    readFileSync(new URL("package-lock.json", root), "utf8"),
  );
  const text = readFileSync(
    new URL("apps/web/public/third-party-licenses.txt", root),
    "utf8",
  );
  const platforms = Object.entries(lock.packages).filter(([path]) =>
    /node_modules\/@napi-rs\/canvas-[^/]+$/.test(path),
  );
  assert(platforms.some(([path]) => path.includes("win32")));
  assert(platforms.some(([path]) => path.includes("darwin")));
  for (const [path, pkg] of platforms)
    assert(
      text.includes(
        `${path.split("node_modules/").at(-1)}@${pkg.version}\nDeclared license: ${pkg.license}`,
      ),
    );
  assert(text.includes("standard_fonts/LICENSE_FOXIT"));
  assert(text.includes("wasm/LICENSE_OPENJPEG"));
});
