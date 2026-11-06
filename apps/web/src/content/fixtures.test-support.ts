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
  } = {},
) {
  const files: Record<string, Uint8Array> = {};
  const descriptors: ContentFile[] = [];
  const declarations = [
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
  ] as const;
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
    files[path] = bytes;
    descriptors.push({
      id,
      kind,
      path,
      media_type:
        kind === "textbook"
          ? "text/markdown; charset=utf-8"
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
