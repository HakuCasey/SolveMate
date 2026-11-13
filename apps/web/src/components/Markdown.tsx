import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import styles from "./Markdown.module.css";

import { normalizeMathDelimiters } from "../reading/normalize-math";
export { normalizeMathDelimiters } from "../reading/normalize-math";

interface MarkdownProps {
  children: string;
  className?: string;
  exportMode?: boolean;
}

export function Markdown({
  children,
  className,
  exportMode = false,
}: MarkdownProps) {
  return (
    <div className={[styles.content, className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        components={
          exportMode
            ? { img: ({ alt }) => <span>[图片{alt ? `：${alt}` : ""}]</span> }
            : undefined
        }
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
