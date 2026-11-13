import type { Textbook } from "@solvemate/contracts";
import calculusUrl from "../../../../data/calculus/textbooks/primer.pdf?url";
import calculusIndex from "../../../../data/calculus/textbooks/primer.pages.json";
import cUrl from "../../../../data/c-language/textbooks/primer.pdf?url";
import cIndex from "../../../../data/c-language/textbooks/primer.pages.json";

const sources = [
  { url: calculusUrl, index: calculusIndex },
  { url: cUrl, index: cIndex },
];

/** 旧内容包只有原文时，仅使用原文校验值一致的 PDF，不替换其资料版本。 */
export function bundledTextbookPdf(id: string, sourceSha256?: string) {
  const source = sources.find(
    ({ index }) =>
      index.textbookId === id &&
      (sourceSha256 === undefined || index.sourceSha256 === sourceSha256),
  );
  if (!source) return undefined;
  const metadata: NonNullable<Textbook["pdf"]> = {
    path: "textbooks/primer.pdf",
    pages: source.index.pages,
    chapterPages: source.index.chapterPages,
  };
  return { ...source, metadata };
}
