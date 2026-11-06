import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import styles from "./Markdown.module.css";

/** 将教材中的 LaTeX 分隔符转为 Markdown 数学语法，保留代码中的反斜杠原文。 */
export function normalizeMathDelimiters(source: string): string {
  let result = "";
  let position = 0;
  let fence: { character: string; length: number } | null = null;
  let codeTicks = 0;

  function findClosingTicks(start: number, length: number): boolean {
    const expression = /`+/g;
    expression.lastIndex = start;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(source))) {
      if (match[0].length === length) return true;
    }
    return false;
  }

  function findMathEnd(start: number, end: string): number {
    let candidate = source.indexOf(end, start);
    while (candidate !== -1) {
      let precedingSlashes = 0;
      for (
        let index = candidate - 1;
        index >= 0 && source[index] === "\\";
        index--
      )
        precedingSlashes++;
      if (precedingSlashes % 2 === 0) return candidate;
      candidate = source.indexOf(end, candidate + end.length);
    }
    return -1;
  }

  while (position < source.length) {
    const atLineStart = position === 0 || source[position - 1] === "\n";
    if (atLineStart && codeTicks === 0) {
      const newline = source.indexOf("\n", position);
      const endOfLine = newline === -1 ? source.length : newline + 1;
      const line = source.slice(position, endOfLine);
      const marker = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n?$/.exec(line);
      if (fence) {
        result += line;
        if (
          marker &&
          marker[1]![0] === fence.character &&
          marker[1]!.length >= fence.length &&
          !marker[2]!.trim()
        )
          fence = null;
        position = endOfLine;
        continue;
      }
      if (marker && !(marker[1]![0] === "`" && marker[2]!.includes("`"))) {
        fence = { character: marker[1]![0]!, length: marker[1]!.length };
        result += line;
        position = endOfLine;
        continue;
      }
    }

    if (source[position] === "`") {
      const ticks = /^`+/.exec(source.slice(position))![0];
      if (codeTicks === ticks.length) codeTicks = 0;
      else if (
        codeTicks === 0 &&
        findClosingTicks(position + ticks.length, ticks.length)
      )
        codeTicks = ticks.length;
      result += ticks;
      position += ticks.length;
      continue;
    }

    if (codeTicks === 0 && source[position] === "\\") {
      const next = source[position + 1];
      if (next === "\\") {
        result += source.slice(position, position + 2);
        position += 2;
        continue;
      }
      if (next === "(" || next === "[") {
        const end = findMathEnd(position + 2, next === "(" ? "\\)" : "\\]");
        if (end !== -1) {
          const formula = source.slice(position + 2, end).trim();
          result +=
            next === "(" ? `$${formula}$` : `\n\n$$\n${formula}\n$$\n\n`;
          position = end + 2;
          continue;
        }
      }
    }

    result += source[position];
    position++;
  }
  return result;
}

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={[styles.content, className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { throwOnError: false, trust: false, strict: "ignore" },
          ],
        ]}
      >
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
