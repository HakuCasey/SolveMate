import { SidebarLayout } from "./SidebarLayout";
import type { PersonalMaterials } from "../materials/useMaterials";
import { materialFixtures } from "../content/library.test-support";
import { createInitialData } from "../data/catalog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficialLibrary } from "../content/library";
import { ContentManager } from "./ContentManager";
import { makeSnapshot } from "../content/storage";
import { packageFixture } from "../content/fixtures.test-support";
import { readPackage } from "../content/package";
import type { RemoteCourse, UpdateResponse } from "../content/contracts";
import type { OfficialContent } from "../content/useOfficialContent";

function render(
  snapshot = makeSnapshot(),
  updates: Record<string, UpdateResponse> = {},
  hasLocalFiles = true,
  remote: RemoteCourse[] = [],
) {
  const content: OfficialContent = {
    snapshot,
    readSnapshot: () => snapshot,
    reloadLocal: async () => snapshot,
    ready: true,
    loadError: "",
    remote,
    updates,
    checking: false,
    checkedAt: 1,
    connectionError: "",
    transfer: null,
    refresh: async () => undefined,
    install: async () => null,
    cancel: () => undefined,
  };
  return renderToStaticMarkup(
    createElement(SidebarLayout, {
      className: "workspace",
      children: createElement(ContentManager, {
        content,
        tools: {
          items: [],
          remote: [],
          checking: false,
          error: "",
          busy: null,
          refresh: async () => {},
          save: async () => createInitialData(),
          select: async () => createInitialData(),
          rename: async () => createInitialData(),
          remove: async () => createInitialData(),
          download: async () => createInitialData(),
        },
        onUseTool: async () => {},
        library: new OfficialLibrary(
          snapshot,
          {
            materials: materialFixtures(snapshot.activeCourses).map((item) => ({
              ...item,
              availability: {
                originalAvailable: hasLocalFiles,
                readerAvailable: hasLocalFiles,
                error: null,
              },
              updatedAt:
                snapshot.installed.find(
                  (saved) => saved.courseId === item.subjectId,
                )?.installedAt ?? 0,
            })),
          },
          remote,
          updates,
        ),
        operation: { busy: false, error: "" },
        onInstall: async () => false,
        onRead: async () => undefined,
        materials: {
          items: materialFixtures(snapshot.activeCourses),
          busy: "",
          error: "",
        } as PersonalMaterials,
      }),
    }),
  );
}

describe("official material cards", () => {
  it("announces newer content while retaining reading actions for the saved version", async () => {
    const before = await packageFixture();
    const next = await packageFixture("", { pdf: true });
    const course = await readPackage(before.manifest, before.archive);
    const snapshot = makeSnapshot(
      [
        {
          ...before,
          course,
          courseId: course.id,
          version: course.version,
          installedAt: 1,
        },
      ],
      [{ courseId: course.id, version: course.version }],
    );
    const html = render(snapshot, {
      [course.id]: {
        course_id: course.id,
        current_version: course.version,
        latest: next.manifest,
        status: "update_available",
        update_available: true,
      },
    });
    expect(html).not.toContain("项内容可更新");
    expect(html).toContain("检查更新");
    expect(html).toContain("有新版可更新");
    expect(html).toContain(">阅读</button>");
    expect(html).toContain(">更新</button>");
    expect(
      snapshot.activeCourses.find((item) => item.id === course.id)?.version,
    ).toBe(before.manifest.version);
  });

  it("shows material names and subject tags, with download actions before saving", () => {
    const html = render(makeSnapshot(), {}, false);
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
  it("shows publication dates for the installed version rather than the local save date", async () => {
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
      {},
      true,
      [
        {
          ...manifest.course,
          latest_version: "f".repeat(64),
          versions: [manifest.version, "f".repeat(64)],
          publication_dates: {
            [manifest.version]: {
              textbooks: "2026-11-05",
              questions: "2026-11-06",
            },
            ["f".repeat(64)]: {
              textbooks: "2026-11-28",
              questions: "2026-11-27",
            },
          },
        },
      ],
    );
    expect(html).toContain("社区更新");
    expect(html).toContain('dateTime="2026-11-05"');
    expect(html).toContain('dateTime="2026-11-06"');
    expect(html).not.toContain("2026-11-28");
    expect(html).not.toContain("2026-11-27");
    expect(html).not.toContain("2026-11-12");
    expect(html).not.toContain("日期未知");
    expect(html).toContain(">阅读</button>");
    expect(html.match(/>阅读<\/button>/g)).toHaveLength(4);
    expect(html).not.toContain(manifest.version.slice(0, 8));
    expect(html).not.toContain(manifest.course.release);
  });
});
