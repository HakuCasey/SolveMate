import type { Note, Notebook } from "@solvemate/contracts";
import { Markdown } from "./Markdown";

/** 导出使用固定白纸排版，不随当前界面明暗模式改变。 */
export const notebookPrintCss = `
@page { size: A4; margin: 19mm 18mm 20mm; @bottom-center { content: counter(page); font: 9pt sans-serif; color: #777; } }
body { margin: 0; color: #20252c; background: white; font: 11pt/1.8 "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; overflow-wrap: anywhere; }
h1 { margin: 10mm 0 3mm; font-size: 25pt; line-height: 1.4; }
h2 { font-size: 19pt; line-height: 1.5; margin: 0 0 6mm; }
h3 { font-size: 14pt; } h4 { font-size: 12pt; } h1,h2,h3,h4 { break-after: avoid; }
p { margin: 0 0 4mm; orphans: 3; widows: 3; }
a { color: #36557c; text-decoration: none; }
.cover { margin-bottom: 10mm; } .muted { color: #69717c; font-size: 9pt; }
.contents { padding-left: 6mm; } .note { break-before: page; }
pre { background: #f4f5f7; border: 1px solid #e1e4e9; border-radius: 4px; padding: 4mm; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9pt; }
code { font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em; }
blockquote { margin: 4mm 0; border-left: 2px solid #b6bdc9; padding-left: 4mm; color: #4c5666; }
table { width: 100%; border-collapse: collapse; margin: 4mm 0; font-size: 10pt; }
th,td { padding: 2mm; border: 1px solid #d5d9df; text-align: left; } th { background: #f4f5f7; } thead { display: table-header-group; } tr { break-inside: avoid; }
.katex-display { overflow: visible; break-inside: avoid; } .katex-display > .katex { white-space: normal; }
hr { border: 0; border-top: 1px solid #ddd; margin: 6mm 0; }
`;

export function NotebookDocument({
  notebook,
  notes,
  tags,
}: {
  notebook: Notebook;
  notes: Note[];
  tags: Record<string, string>;
}) {
  return (
    <main>
      <header className="cover">
        <h1>{notebook.title}</h1>
        <p className="muted">{notes.length} 篇笔记</p>
        {notes.length ? (
          <ol className="contents">
            {notes.map((note, index) => (
              <li key={note.id}>
                <a href={`#note-${index}`}>{note.title}</a>
              </li>
            ))}
          </ol>
        ) : (
          <p>这个笔记本还没有笔记。</p>
        )}
      </header>
      {notes.map((note, index) => (
        <section className="note" id={`note-${index}`} key={note.id}>
          <h2>{note.title}</h2>
          {note.tagIds.some((id) => !id.startsWith("subject:") && tags[id]) && (
            <p className="muted">
              {note.tagIds
                .filter((id) => !id.startsWith("subject:"))
                .map((id) => tags[id])
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {note.excerpt && <p className="muted">来源：{note.excerpt.title}</p>}
          <Markdown exportMode>{note.content}</Markdown>
        </section>
      ))}
    </main>
  );
}
