import type { Chapter, Textbook } from "@solvemate/contracts";

/** 按教材中已有的章节锚点切分，保留原文中的公式、代码和换行。 */
export function parseTextbook(id: string, markdown: string): Textbook {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  const headings = [
    ...markdown.matchAll(/^<a id="([^"]+)"><\/a>\s*\n##\s+([^\n]+)\n/gm),
  ];

  if (!title || headings.length === 0) {
    throw new Error(`Textbook has no valid title or chapters: ${id}`);
  }

  const chapters: Chapter[] = headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const next = headings[index + 1];
    return {
      id: heading[1]!,
      title: heading[2]!.trim(),
      content: markdown.slice(start, next?.index ?? markdown.length).trim(),
    };
  });

  const preface = markdown.slice(0, headings[0]!.index);
  const description = preface
    .replace(/^#\s+.+$/m, "")
    .trim()
    .split(/\n\s*\n/)
    .at(-1)
    ?.replace(/\s+/g, " ")
    .trim();
  return { id, title, description, chapters };
}
