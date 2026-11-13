import { unzipSync } from "fflate";
import type {
  Course,
  Question,
  LearningPoint,
  DiscussionPoint,
  MemorySource,
} from "@solvemate/contracts";
import { bundledTextbookPdf } from "../data/textbook-pdfs";
import { parseTextbook } from "../data/textbooks";
import {
  ContentError,
  items,
  record,
  text,
  unique,
  parseFiles,
  parseManifest,
  info,
  type ReleaseManifest,
} from "./contracts";

export async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(result), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
function json(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function source(value: unknown): MemorySource {
  const data = record(value),
    ids = items(data.question_ids).map(text);
  if (!ids.length) throw new ContentError("课程记忆缺少来源题目。");
  return { textbook: text(data.textbook), question_ids: ids };
}
function normalizeReference(
  memoryPath: string,
  reference: string,
): [string, string] {
  const [path, anchor, extra] = reference.split("#");
  if (
    !anchor ||
    extra !== undefined ||
    /[:?\\\0]/.test(path) ||
    path.startsWith("/")
  )
    throw new ContentError("课程记忆的教材引用不正确。");
  const parts = memoryPath.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "..") {
      if (!parts.length) throw new ContentError("课程记忆引用越过了课程目录。");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return [parts.join("/"), anchor];
}

/** 包、原文件、结构与交叉引用均验证成功后，调用方才能提交本地事务。 */
export async function readPackage(
  input: unknown,
  archive: Uint8Array,
  signal?: AbortSignal,
): Promise<Course> {
  const manifest = parseManifest(input);
  signal?.throwIfAborted();
  if (
    archive.byteLength !== manifest.size_bytes ||
    (await sha256(archive)) !== manifest.sha256
  )
    throw new ContentError("内容包校验失败，原有内容未被替换。");
  signal?.throwIfAborted();
  const expected = new Map(
    manifest.files.map((file) => [file.path, file.size_bytes]),
  );
  expected.set("course.json", 256 * 1024);
  const seen = new Set<string>();
  const files = unzipSync(archive, {
    filter(file) {
      const maximum = expected.get(file.name);
      if (
        maximum === undefined ||
        seen.has(file.name) ||
        file.originalSize > maximum
      )
        throw new ContentError("内容包中包含未声明、重复或过大的文件。");
      seen.add(file.name);
      return true;
    },
  });
  if (seen.size !== expected.size)
    throw new ContentError("内容包缺少必要文件。");
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    if (
      files[file.path].byteLength !== file.size_bytes ||
      (await sha256(files[file.path])) !== file.sha256
    )
      throw new ContentError("课程文件校验失败，原有内容未被替换。");
  }
  const inside = record(json(files["course.json"]));
  if (
    inside.schema_version !== 1 ||
    JSON.stringify(info(inside.course)) !== JSON.stringify(manifest.course) ||
    JSON.stringify(parseFiles(inside.files)) !== JSON.stringify(manifest.files)
  )
    throw new ContentError("包内清单与下载版本不一致。");
  const byKind = (kind: ReleaseManifest["files"][number]["kind"]) =>
    manifest.files.find((file) => file.kind === kind)!;
  const textbookFile = byKind("textbook");
  const book = parseTextbook(
    textbookFile.id,
    new TextDecoder("utf-8", { fatal: true }).decode(files[textbookFile.path]),
  );
  unique(book.chapters.map((chapter) => chapter.id));
  const pdfFile = manifest.files.find((file) => file.kind === "textbook-pdf");
  const pageFile = manifest.files.find(
    (file) => file.kind === "textbook-pages",
  );
  if (pdfFile && pageFile) {
    const index = record(json(files[pageFile.path]));
    const pages = items(index.pages).map((page) => {
      if (typeof page !== "string")
        throw new ContentError("PDF 页内文字格式不正确。");
      return page;
    });
    const chapterPages = items(index.chapterPages).map((page) => {
      if (
        typeof page !== "number" ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > pages.length
      )
        throw new ContentError("PDF 章节页码不正确。");
      return page;
    });
    if (
      !pages.length ||
      pages.length > 1000 ||
      index.textbookId !== book.id ||
      index.sourceSha256 !== textbookFile.sha256 ||
      index.pdfSha256 !== pdfFile.sha256 ||
      pdfFile.media_type !== "application/pdf" ||
      new TextDecoder().decode(files[pdfFile.path].slice(0, 5)) !== "%PDF-" ||
      chapterPages.length !== book.chapters.length ||
      chapterPages.some((page, i) => i > 0 && page <= chapterPages[i - 1])
    )
      throw new ContentError("PDF 与资料原文或页码索引不一致。");
    book.pdf = { path: pdfFile.path, pages, chapterPages };
  } else {
    book.pdf = bundledTextbookPdf(book.id, textbookFile.sha256)?.metadata;
  }

  const questionsFile = record(json(files[byKind("questions").path]));
  if (questionsFile.course !== manifest.course.title)
    throw new ContentError("题库不属于当前课程。");
  const questions: Question[] = items(questionsFile.questions).map((value) => {
    const row = record(value);
    return {
      id: text(row.id),
      title: text(row.title),
      topic: text(row.topic),
      difficulty: text(row.difficulty),
      question: text(row.question),
      answer: text(row.answer),
      explanation: text(row.explanation),
    };
  });
  if (!questions.length) throw new ContentError("题库不能为空。");
  unique(questions.map((question) => question.id));
  const memory = (kind: "learning-points" | "discussion-points") => {
    const file = byKind(kind),
      data = record(json(files[file.path]));
    if (data.course !== manifest.course.title)
      throw new ContentError("课程记忆不属于当前课程。");
    text(data.origin);
    const rows = items(data.points).map((value) => {
      const row = record(value),
        origin = source(row.source);
      const [path, anchor] = normalizeReference(file.path, origin.textbook);
      if (
        path !== textbookFile.path ||
        !book.chapters.some((chapter) => chapter.id === anchor) ||
        !origin.question_ids.every((id) =>
          questions.some((question) => question.id === id),
        )
      )
        throw new ContentError("课程记忆引用了不存在的题目或教材章节。");
      return { row, origin, id: text(row.id), title: text(row.title) };
    });
    if (!rows.length) throw new ContentError("课程记忆不能为空。");
    unique(rows.map((row) => row.id));
    return rows;
  };
  const learningPoints: LearningPoint[] = memory("learning-points").map(
    ({ row, origin, id, title }) => ({
      id,
      title,
      source: origin,
      content: text(row.content),
      common_mistake: text(row.common_mistake),
    }),
  );
  const discussionPoints: DiscussionPoint[] = memory("discussion-points").map(
    ({ row, origin, id, title }) => {
      const prompts = items(row.prompts).map(text);
      if (!prompts.length) throw new ContentError("讨论点缺少推荐问题。");
      return {
        id,
        title,
        source: origin,
        prompts,
        guidance: text(row.guidance),
      };
    },
  );
  signal?.throwIfAborted();
  return {
    id: manifest.course.id,
    title: manifest.course.title,
    version: manifest.version,
    questions,
    textbooks: [book],
    memory: { learningPoints, discussionPoints },
  };
}
