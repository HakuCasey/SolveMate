import { useRef, useState } from "react";
import { AlertDialog, Dialog } from "radix-ui";
import { Download, FileUp, Plus, Wrench, X } from "lucide-react";
import type { TeachingTool } from "@solvemate/contracts";
import { useUnsavedForm } from "../refresh/drafts";
import { useSaveFeedback } from "../components/SaveFeedback";
import { TeachingToolActions } from "./TeachingToolActions";
import { customTool, readToolText, toolTitle } from "./state";
import type { TeachingTools } from "./useTeachingTools";
import styles from "./QuestionResearchPanel.module.css";

type ImportTarget = "skill" | "template";

/** 左侧选择工具，右侧同时核对 Skill 和输出模板；修改后另存为自定义工具。 */
export function ToolChoiceDialog({
  original: initialOriginal,
  tools,
  onClose,
  onOfficial,
  onUsed,
}: {
  original?: TeachingTool;
  tools: TeachingTools;
  onClose: () => void;
  onOfficial?: () => void;
  onUsed?: () => void;
}) {
  const [original, setOriginal] = useState<TeachingTool | undefined>(
    initialOriginal,
  );
  const [draft, setDraft] = useState(() => customTool(initialOriginal));
  const [pending, setPending] = useState<TeachingTool | "new" | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const importTarget = useRef<ImportTarget>("skill");
  const changed =
    !original ||
    draft.skill.content !== original.skill.content ||
    draft.template.content !== original.template.content;
  const dirty = changed && (!!draft.skill.content || !!draft.template.content);
  const release = useUnsavedForm("teaching-tool-editor", dirty);
  const feedback = useSaveFeedback();
  const busy = !!tools.busy || importing;

  function load(tool?: TeachingTool) {
    const saved = tool ? structuredClone(tool) : undefined;
    setOriginal(saved);
    setDraft(customTool(saved));
    setError("");
  }

  function requestLoad(tool?: TeachingTool) {
    if (original?.id === tool?.id) return;
    if (dirty) setPending(tool ?? "new");
    else load(tool);
  }

  function close() {
    if (busy) return;
    release();
    onClose();
  }

  function startImport(target: ImportTarget) {
    importTarget.current = target;
    input.current?.click();
  }

  async function confirm() {
    setError("");
    if (!draft.skill.content.trim() || !draft.template.content.trim()) {
      setError("请填写 Skill 和输出模板。");
      return;
    }
    if (changed && !draft.title.trim()) {
      setError("请填写工具名称。");
      return;
    }
    try {
      if (changed) await tools.save(draft);
      else await tools.select(original!.id, original);
      release();
      feedback(changed ? "工具已保存并选中" : "工具已选中");
      onClose();
      onUsed?.();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "工具保存失败，请重试。",
      );
    }
  }

  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.toolDialog}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <header className={styles.pickerHeader}>
              <Dialog.Title>
                <Wrench />
                工具选择
              </Dialog.Title>
              <button aria-label="关闭工具选择" disabled={busy} onClick={close}>
                <X />
              </button>
            </header>
            <Dialog.Description className={styles.srOnly}>
              从左侧选择工具，在右侧核对或修改 Skill 和输出模板。
            </Dialog.Description>
            <div className={styles.toolWorkspace}>
              <aside className={styles.toolRail} aria-label="工具列表">
                <div className={styles.toolList}>
                  {tools.items.map((tool) => (
                    <TeachingToolActions
                      key={tool.id}
                      tool={tool}
                      tools={tools}
                      onRenamed={(name) => {
                        if (original?.id === tool.id)
                          setOriginal({ ...original, customTitle: name });
                      }}
                      onDeleted={() => {
                        if (original?.id !== tool.id) return;
                        if (dirty) setOriginal(undefined);
                        else load();
                      }}
                    >
                      <button
                        aria-current={
                          original?.id === tool.id ? "true" : undefined
                        }
                        disabled={busy}
                        onClick={() => requestLoad(tool)}
                        title={toolTitle(tool)}
                      >
                        {toolTitle(tool)}
                      </button>
                    </TeachingToolActions>
                  ))}
                  {!tools.items.length && (
                    <p className={styles.toolEmpty}>还没有工具</p>
                  )}
                </div>
                <div className={styles.toolRailActions}>
                  <button disabled={busy} onClick={() => requestLoad()}>
                    <Plus />
                    新建工具
                  </button>
                  {onOfficial && (
                    <button disabled={busy} onClick={onOfficial}>
                      <Download />
                      下载社区工具
                    </button>
                  )}
                </div>
              </aside>
              <div className={styles.toolEditor}>
                <input
                  ref={input}
                  type="file"
                  hidden
                  accept=".md,.txt"
                  aria-label="导入工具内容"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const target = importTarget.current;
                    setImporting(true);
                    setError("");
                    try {
                      const content = await readToolText(file);
                      setDraft((current) => ({
                        ...current,
                        [target]: { ...current[target], content },
                      }));
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "文件读取失败。",
                      );
                    } finally {
                      setImporting(false);
                    }
                  }}
                />
                {changed && (
                  <label className={styles.toolName}>
                    {original ? "另存为名称" : "工具名称"}
                    <input
                      maxLength={80}
                      value={draft.title}
                      disabled={busy}
                      placeholder="填写工具名称"
                      onChange={(event) => {
                        setError("");
                        setDraft({ ...draft, title: event.target.value });
                      }}
                    />
                  </label>
                )}
                <section className={styles.toolSection}>
                  <header>
                    <h3>Skill</h3>
                    <button
                      disabled={busy}
                      onClick={() => startImport("skill")}
                    >
                      <FileUp />
                      导入
                    </button>
                  </header>
                  <textarea
                    aria-label="Skill 内容"
                    maxLength={20000}
                    disabled={busy}
                    value={draft.skill.content}
                    onChange={(event) => {
                      setError("");
                      setDraft({
                        ...draft,
                        skill: { ...draft.skill, content: event.target.value },
                      });
                    }}
                  />
                </section>
                <section className={styles.toolSection}>
                  <header>
                    <h3>输出模板</h3>
                    <button
                      disabled={busy}
                      onClick={() => startImport("template")}
                    >
                      <FileUp />
                      导入
                    </button>
                  </header>
                  <textarea
                    aria-label="输出模板内容"
                    maxLength={20000}
                    disabled={busy}
                    value={draft.template.content}
                    onChange={(event) => {
                      setError("");
                      setDraft({
                        ...draft,
                        template: {
                          ...draft.template,
                          content: event.target.value,
                        },
                      });
                    }}
                  />
                </section>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <footer className={`${styles.formActions} ${styles.editorFooter}`}>
              <button disabled={busy} onClick={close}>
                取消
              </button>
              <button
                type="submit"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {tools.busy ? "正在保存…" : "确定"}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.overlayTop} />
          <AlertDialog.Content className={styles.confirmTop}>
            <AlertDialog.Title>放弃当前修改？</AlertDialog.Title>
            <AlertDialog.Description>
              切换工具后，当前修改不会保留。
            </AlertDialog.Description>
            <div className={styles.formActions}>
              <AlertDialog.Cancel>取消</AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => {
                  const target = pending;
                  setPending(null);
                  load(target === "new" ? undefined : (target ?? undefined));
                }}
              >
                继续切换
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
