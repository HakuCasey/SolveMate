import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import type { ContentFile, ReleaseManifest } from "./contracts";
import { sha256 } from "./package";

export async function packageFixture(
  marker = "",
  options: {
    badReference?: boolean;
    extraFile?: boolean;
    invalidQuestions?: boolean;
    pdf?: boolean;
    badPdfIndex?: boolean;
  } = {},
) {
  const files: Record<string, Uint8Array> = {};
  const descriptors: ContentFile[] = [];
  const declarations: [string, ContentFile["kind"], string][] = [
    ["B001", "textbook", "textbooks/primer.md"],
    ["calculus-questions", "questions", "questions/questions.json"],
    [
      "calculus-learning-points",
      "learning-points",
      "memory/learning-points.json",
    ],
    [
      "calculus-discussion-points",
      "discussion-points",
      "memory/discussion-points.json",
    ],
  ];
  if (options.pdf || options.badPdfIndex)
    declarations.push(
      ["B001-pdf", "textbook-pdf", "textbooks/primer.pdf"],
      ["B001-pages", "textbook-pages", "textbooks/primer.pages.json"],
    );
  for (const [id, kind, path] of declarations) {
    let bytes = new Uint8Array(
      readFileSync(
        new URL(`../../../../data/calculus/${path}`, import.meta.url),
      ),
    );
    if (kind === "questions" && marker) {
      const data = JSON.parse(new TextDecoder().decode(bytes));
      data.questions[0].question += `\n${marker}`;
      bytes = new TextEncoder().encode(JSON.stringify(data));
    }
    if (kind === "questions" && options.invalidQuestions)
      bytes = new TextEncoder().encode('{"course":"高等数学","questions":[]}');
    if (kind === "learning-points" && options.badReference) {
      const data = JSON.parse(new TextDecoder().decode(bytes));
      data.points[0].source.question_ids = ["M999"];
      bytes = new TextEncoder().encode(JSON.stringify(data));
    }
    if (kind === "textbook-pages" && options.badPdfIndex) {
      const index = JSON.parse(new TextDecoder().decode(bytes));
      index.chapterPages[0] = index.pages.length + 1;
      bytes = new TextEncoder().encode(JSON.stringify(index));
    }
    files[path] = bytes;
    descriptors.push({
      id,
      kind,
      path,
      media_type:
        kind === "textbook"
          ? "text/markdown; charset=utf-8"
          : kind === "textbook-pdf"
            ? "application/pdf"
            : "application/json",
      size_bytes: bytes.length,
      sha256: await sha256(bytes),
    });
  }
  const course = {
    id: "calculus",
    title: "高等数学",
    description: "测试课程",
    release: "test-release",
  };
  files["course.json"] = new TextEncoder().encode(
    JSON.stringify({ schema_version: 1, course, files: descriptors }),
  );
  if (options.extraFile)
    files["../private.md"] = new TextEncoder().encode("Unexpected file.");
  const archive = zipSync(files, { mtime: new Date(1980, 0, 1) });
  const version = await sha256(archive);
  const manifest: ReleaseManifest = {
    schema_version: 1,
    course,
    version,
    sha256: version,
    size_bytes: archive.length,
    files: descriptors,
    download_url: `/api/v1/courses/calculus/versions/${version}/download`,
  };
  return { archive, manifest };
}
