import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function fixture(t) {
  // 路径包含空格，且不依赖 PATH 中的 npm，覆盖 Windows 的调用条件。
  const directory = await mkdtemp(join(tmpdir(), "solvemate licenses "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of [
    "scripts",
    "apps/web/public",
    "apps/server",
    "dependency",
  ])
    await mkdir(join(directory, path), { recursive: true });
  await copyFile(
    new URL("./generate-license-notices.mjs", import.meta.url),
    join(directory, "scripts/generate-license-notices.mjs"),
  );
  await writeFile(join(directory, "package.json"), '{"name":"solvemate"}');
  await writeFile(join(directory, "LICENSE"), "Project license\n");
  await writeFile(
    join(directory, "dependency/package.json"),
    '{"name":"fixture-dependency","version":"1.0.0","license":"MIT"}',
  );
  await writeFile(join(directory, "dependency/LICENSE"), "Fixture license\r\n");
  const npmCli = join(directory, "npm cli.cjs");
  await writeFile(
    npmCli,
    `const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['ls', '--omit=dev', '--all', '--parseable']);
process.stdout.write(${JSON.stringify(`${directory}\r\n${join(directory, "dependency")}\r\n`)});`,
  );
  // 可选平台依赖的元数据也使用副本，测试不读取本机安装结果。
  const canvas = join(directory, "node_modules/@napi-rs/canvas");
  await mkdir(canvas, { recursive: true });
  await writeFile(
    join(canvas, "package.json"),
    '{"version":"1.0.0","license":"MIT"}',
  );
  await writeFile(join(canvas, "LICENSE"), "Fixture canvas license\n");
  await writeFile(join(directory, "package-lock.json"), '{"packages":{}}');
  function run(args = [], cli = npmCli) {
    const env = { ...process.env, PATH: "", npm_execpath: cli };
    if (!cli) delete env.npm_execpath;
    return spawnSync(
      process.execPath,
      [join(directory, "scripts/generate-license-notices.mjs"), ...args],
      { cwd: directory, env, encoding: "utf8", timeout: 30000 },
    );
  }
  return { directory, run };
}

test("license CLI handles spaces and CRLF paths without a PATH npm command", async (t) => {
  const { directory, run } = await fixture(t);
  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  const output = join(directory, "apps/web/public/third-party-licenses.txt");
  const text = await readFile(output, "utf8");
  assert.ok(text.includes("fixture-dependency@1.0.0\nDeclared license: MIT"));
  assert.ok(text.includes("Fixture license"));
  assert.equal(text.includes("\r"), false);
  assert.equal(run(["--check"]).status, 0);
  await writeFile(output, "Outdated content\n");
  const checked = run(["--check"]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Outdated .*third-party-licenses.txt/);
});

test("license CLI explains how to run when npm has not supplied its CLI path", async (t) => {
  const { run } = await fixture(t);
  const checked = run(["--check"], "");
  assert.notEqual(checked.status, 0);
  assert.match(
    checked.stderr,
    /Run this script with npm run licenses:generate/,
  );
});
