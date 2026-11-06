import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import katex from "katex";
import { Markdown, normalizeMathDelimiters } from "./Markdown";

describe("Markdown rendering after the KaTeX upgrade", () => {
  it("renders inline and display math and preserves C code", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children:
          '当 \\(x \\ne 0\\) 时：\n\\[\\frac{x}{x}=1\\]\n\n```c\nprintf("\\n");\n```',
      }),
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="language-c"');
    expect(html).toContain("printf(&quot;\\n&quot;);");
    expect(html).not.toContain("katex-error");
  });

  it("does not enable trusted HTML from an inherited renderer setting", () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
    try {
      // 复现上游公告中的前置污染，只允许显式的渲染配置启用信任。
      Object.defineProperty(Object.prototype, "trust", {
        value: true,
        writable: true,
        configurable: true,
      });
      const html = katex.renderToString("\\href{javascript:alert(1)}{x}", {
        throwOnError: false,
        strict: "ignore",
      });
      expect(html).not.toMatch(/<a\b[^>]*href=/);
    } finally {
      if (original) Object.defineProperty(Object.prototype, "trust", original);
      else Reflect.deleteProperty(Object.prototype, "trust");
    }
  });

  it("does not render raw HTML or active JavaScript links", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children:
          "<script>alert(1)</script>\n\n[link](javascript:alert(1))\n\n$\\href{javascript:alert(1)}{x}$",
      }),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/href=["']javascript:/);
  });
});

describe("normalizeMathDelimiters", () => {
  it("converts inline and display formulas from the textbook syntax", () => {
    expect(
      normalizeMathDelimiters("当 \\(x\\ne0\\) 时：\n\\[\n\\frac{x}{x}=1\n\\]"),
    ).toBe("当 $x\\ne0$ 时：\n\n\n$$\n\\frac{x}{x}=1\n$$\n\n");
  });

  it("leaves C strings and formulas inside fenced code unchanged", () => {
    const code =
      '```c\nconst char *text = "\\(x\\)";\nprintf("\\[ %s \\]", text);\n```';
    expect(normalizeMathDelimiters(code)).toBe(code);
    expect(
      normalizeMathDelimiters("~~~text\n\\[not math\\]\n~~~\n\\(x\\)"),
    ).toBe("~~~text\n\\[not math\\]\n~~~\n$x$");
  });

  it("recognizes the full fence length before processing following prose", () => {
    const source = "````text\n```\n\\(code\\)\n````\n\\(math\\)";
    expect(normalizeMathDelimiters(source)).toBe(
      "````text\n```\n\\(code\\)\n````\n$math$",
    );
  });

  it("preserves inline code with single and multiple backticks", () => {
    const source = "`\\(code\\)` 与 ``a ` \\[b\\]``，然后 \\(x\\)。";
    expect(normalizeMathDelimiters(source)).toBe(
      "`\\(code\\)` 与 ``a ` \\[b\\]``，然后 $x$。",
    );
  });

  it("preserves escaped delimiters and incomplete formulas", () => {
    expect(normalizeMathDelimiters("\\\\(literal\\\\) 与 \\(not closed")).toBe(
      "\\\\(literal\\\\) 与 \\(not closed",
    );
  });

  it("does not treat an unmatched backtick as code covering the remaining text", () => {
    expect(normalizeMathDelimiters("一个 `，然后 \\(x\\)。")).toBe(
      "一个 `，然后 $x$。",
    );
  });
});
