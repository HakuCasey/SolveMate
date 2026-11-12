import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputs = [
  "packages/contracts/src/ai-metadata.generated.ts",
  "apps/local/src/solvemate_local/schemas/ai-metadata.schema.json",
  "apps/local/src/solvemate_local/schemas/ai-metadata-v2.schema.json",
];
const sources = [
  "packages/contracts/ai-metadata.schema.json",
  "packages/contracts/legacy/ai-metadata-v2.schema.json",
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "solvemate-contracts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scripts"));
  await copyFile(
    join(root, "scripts/generate-ai-contracts.mjs"),
    join(directory, "scripts/generate-ai-contracts.mjs"),
  );
  // 使用目录联接兼容 Windows；脚本与输入均为副本，不改动项目的真实文件。
  await symlink(
    join(root, "node_modules"),
    join(directory, "node_modules"),
    "junction",
  );
  for (const path of sources) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(
      join(directory, path),
      JSON.stringify(
        {
          title: "FixtureContract",
          type: "object",
          properties: { question: { type: "string" } },
          required: ["question"],
          additionalProperties: false,
        },
        null,
        2,
      ) + "\n",
    );
  }
  function run(...args) {
    return spawnSync(
      process.execPath,
      [join(directory, "scripts/generate-ai-contracts.mjs"), ...args],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 30000,
      },
    );
  }
  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  return { directory, run };
}

test("generated contracts use LF and pass their actual CLI check", async (t) => {
  const { directory, run } = await fixture(t);
  for (const path of outputs)
    assert.equal(
      (await readFile(join(directory, path), "utf8")).includes("\r"),
      false,
    );
  const checked = run("--check");
  assert.equal(checked.status, 0, checked.stderr);
});

test("CRLF sources and generated files pass check without being rewritten", async (t) => {
  const { directory, run } = await fixture(t);
  for (const path of [...sources, ...outputs]) {
    const target = join(directory, path);
    await writeFile(
      target,
      (await readFile(target, "utf8")).replace(/\n/g, "\r\n"),
    );
  }
  const checked = run("--check");
  assert.equal(checked.status, 0, checked.stderr);
  for (const path of outputs)
    assert.ok((await readFile(join(directory, path), "utf8")).includes("\r\n"));
  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  for (const path of outputs)
    assert.equal(
      (await readFile(join(directory, path), "utf8")).includes("\r"),
      false,
    );
});

test("real TypeScript changes are still rejected and regeneration repairs them", async (t) => {
  const { directory, run } = await fixture(t);
  await writeFile(
    join(directory, outputs[0]),
    "export type FixtureContract = number;\r\n",
  );
  const checked = run("--check");
  assert.notEqual(checked.status, 0);
  assert.match(
    checked.stderr,
    /Generated AI contract is outdated: packages\/contracts\/src\/ai-metadata.generated.ts/,
  );
  assert.equal(run().status, 0);
  assert.equal(run("--check").status, 0);
});

test("real schema-copy changes are rejected for current and legacy formats", async (t) => {
  const { directory, run } = await fixture(t);
  for (const path of outputs.slice(1)) {
    await writeFile(join(directory, path), "{}\r\n");
    const checked = run("--check");
    assert.notEqual(checked.status, 0);
    assert.ok(
      checked.stderr.includes(`Generated AI contract is outdated: ${path}`),
    );
    assert.equal(run().status, 0);
    assert.equal(run("--check").status, 0);
  }
});
