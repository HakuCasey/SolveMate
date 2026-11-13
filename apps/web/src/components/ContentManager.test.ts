import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficialLibrary } from "../content/library";
import { ContentManager } from "./ContentManager";
import { makeSnapshot } from "../content/storage";
import { packageFixture } from "../content/fixtures.test-support";
import { readPackage } from "../content/package";
import type { OfficialContent } from "../content/useOfficialContent";

function render(snapshot = makeSnapshot()) {
  const content: OfficialContent = {
    snapshot,
    readSnapshot: () => snapshot,
    reloadLocal: async () => snapshot,
    ready: true,
    checkedAt: null,
    readPdf: async () => ({ blob: new Blob(), warning: "" }),
    loadError: "",
    remote: [],
    updates: {},
    checking: false,
    connectionError: "",
    transfer: null,
    refresh: async () => undefined,
    install: async () => null,
    cancel: () => undefined,
  };
  return renderToStaticMarkup(
    createElement(ContentManager, {
      content,
      library: new OfficialLibrary(snapshot),
      operation: { busy: false, error: "" },
      onInstall: async () => false,
      onRead: async () => undefined,
      onRemove: async () => undefined,
    }),
  );
}

describe("official material cards", () => {
  it("shows material names and subject tags, with download actions before saving", () => {
    const html = render();
    expect(html).toContain('aria-label="高等数学示例教材"');
    expect(html).toContain('aria-label="C 语言示例教材"');
    expect(html).toContain('aria-label="高等数学题目"');
    expect(html).toContain('aria-label="C 语言题目"');
    expect(html).toContain("24 道题目，包含答案和讲解。");
    expect(html).toContain("12 道题目，包含答案和讲解。");
    expect(html).toContain("每节包含概念、使用条件、例题推导和易错点");
    expect(html).toContain(
      'aria-label="资料分类"><span>高等数学</span><span>学习资料</span>',
    );
    expect(html.match(/尚未下载/g)).toHaveLength(4);
    expect(html.match(/>下载<\/button>/g)).toHaveLength(4);
    expect(html).not.toContain(">阅读</button>");
    expect(html).not.toContain("example-1");
  });
  it("shows the saved date and a reading action without exposing version identifiers", async () => {
    const { archive, manifest } = await packageFixture();
    const course = await readPackage(manifest, archive);
    const html = render(
      makeSnapshot(
        [
          {
            courseId: course.id,
            version: manifest.version,
            manifest,
            archive,
            course,
            installedAt: Date.UTC(2026, 10, 12, 8),
          },
        ],
        [{ courseId: course.id, version: manifest.version }],
      ),
    );
    expect(html).toContain("更新日期");
    expect(html).toContain("2026/11/12");
    expect(html).toContain(">阅读</button>");
    expect(html.match(/尚未下载/g)).toHaveLength(2);
    expect(html).not.toContain(manifest.version.slice(0, 8));
    expect(html).not.toContain(manifest.course.release);
  });
});
