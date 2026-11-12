import { useEditRevision } from "../refresh/useEditRevision";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bot,
  Copy,
  GraduationCap,
  Plus,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { ContextMenu, Tabs } from "radix-ui";
import { RobotAiFields } from "./RobotAiFields";
import { useSaveFeedback } from "./SaveFeedback";
import type { AiSettings } from "../ai/local-api";
import {
  isRobotAiModified,
  robotAiError,
  resolveRobotAi,
} from "../ai/robot-config";
import type { Robot } from "@solvemate/contracts";
import {
  createRobot,
  isRobotModified,
  restoreRobotDefaults,
} from "../state/robots";
import styles from "./RobotsPage.module.css";

interface RobotsPageProps {
  robots: Robot[];
  defaultRobotId: string | null;
  onChange: (robots: Robot[], defaultRobotId: string | null) => Promise<void>;
  onUse: (robot: Robot) => Promise<void>;
  disabled?: boolean;
  aiSettings: AiSettings | null;
  drafts: Record<string, Robot>;
  onDraftsChange: Dispatch<SetStateAction<Record<string, Robot>>>;
}

const skills: { value: Robot["skills"][number]; label: string }[] = [
  { value: "questions", label: "题目讲解" },
  { value: "textbooks", label: "教材阅读" },
  { value: "notes", label: "笔记讨论" },
];

function RobotAvatar({ icon }: { icon: Robot["icon"] }) {
  const Icon =
    icon === "graduation-cap"
      ? GraduationCap
      : icon === "sparkles"
        ? Sparkles
        : Bot;
  return <Icon aria-hidden="true" />;
}

export function RobotsPage({
  robots,
  defaultRobotId,
  onChange,
  onUse,
  disabled = false,
  aiSettings,
  drafts,
  onDraftsChange: setDrafts,
}: RobotsPageProps) {
  const showSaved = useSaveFeedback();
  const [selectedId, setSelectedId] = useState<string | null>(
    robots[0]?.id ?? null,
  );
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  disabled ||= saving;
  const [invalidField, setInvalidField] = useState<
    "name" | "prompt" | "model" | null
  >(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [tab, setTab] = useState("persona");
  const nameInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);

  const selected =
    robots.find((robot) => robot.id === selectedId) ??
    (selectedId ? drafts[selectedId] : undefined) ??
    robots[0];
  const removed =
    !!selected && !robots.some((robot) => robot.id === selected.id);
  const draft = selected ? (drafts[selected.id] ?? selected) : undefined;
  const getRevision = useEditRevision(
    draft ?? { revision: 0 },
    removed ? undefined : selected,
    selected?.id,
  );

  const hasChanges =
    removed || (!!selected && isRobotModified(selected, draft));

  function setDraft(next: Robot) {
    if (!selected) return;
    setDrafts((previous) => {
      const remaining = { ...previous };
      // 输入改回原值时也移除草稿，避免列表留下错误的未保存提示。
      if (isRobotModified(selected, next)) remaining[selected.id] = next;
      else delete remaining[selected.id];
      return remaining;
    });
    setInvalidField(null);
    setStatus("");
  }

  function cancelChanges() {
    if (!selected) return;
    setDrafts((previous) => {
      const remaining = { ...previous };
      delete remaining[selected.id];
      return remaining;
    });
    setInvalidField(null);
    setStatus("已取消修改。");
  }

  function restoreDefaults() {
    if (!selected) return;
    const defaults = restoreRobotDefaults(selected);
    setDraft(defaults);
    setStatus(
      isRobotModified(selected, defaults)
        ? "已恢复默认配置，点击“保存配置”后生效。"
        : "当前已是默认配置。",
    );
  }

  function updateDraft<K extends keyof Robot>(field: K, value: Robot[K]) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  async function addRobot() {
    const robot = createRobot();
    try {
      await onChange([...robots, robot], defaultRobotId ?? robot.id);
    } catch (error) {
      setStatus(String(error));
      return;
    }
    setSelectedId(robot.id);
    setTab("persona");
    setInvalidField(null);
    setStatus("已新建机器人，可以修改它的配置。");
  }

  async function saveRobot(): Promise<Robot | null> {
    if (!draft || removed) return null;
    const next = {
      ...draft,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),

      skills: [...draft.skills],
    };
    if (!next.name || !next.prompt) {
      const field = !next.name ? "name" : "prompt";
      setInvalidField(field);
      setTab("persona");
      setStatus(field === "name" ? "请填写机器人名称。" : "请填写角色指令。");
      if (field === "name") nameInput.current?.focus();
      else promptInput.current?.focus();
      return null;
    }
    const error =
      selected && isRobotAiModified(selected, next.aiDefaults)
        ? robotAiError(next.aiDefaults, aiSettings)
        : "";
    if (error) {
      setInvalidField("model");
      setTab("model");
      setStatus(error);
      return null;
    }
    setSaving(true);
    try {
      next.revision = getRevision();
      await onChange(
        robots.map((robot) => (robot.id === next.id ? next : robot)),
        defaultRobotId,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存配置失败。");
      setInvalidField("model");
      return null;
    } finally {
      setSaving(false);
    }
    setDrafts((previous) => {
      const remaining = { ...previous };
      delete remaining[next.id];
      return remaining;
    });
    setInvalidField(null);
    setStatus("配置已更新。");
    showSaved();
    return next;
  }

  async function copyRobot(robot: Robot) {
    const base = robot.name.slice(0, 16);
    let name = `${base}（副本）`;
    let number = 2;
    while (robots.some((item) => item.name === name))
      name = `${base}（副本 ${number++}）`;
    const copy = {
      ...robot,
      id: crypto.randomUUID(),
      revision: 1,
      name,
      skills: [...robot.skills],
    };
    try {
      await onChange([...robots, copy], defaultRobotId);
    } catch (error) {
      setStatus(String(error));
      return;
    }
    setSelectedId(copy.id);
    setInvalidField(null);
    setStatus(`已复制“${robot.name}”的已保存配置。`);
  }

  async function deleteRobot(robot: Robot) {
    const remaining = robots.filter((item) => item.id !== robot.id);
    const nextDefault =
      defaultRobotId === robot.id ? (remaining[0]?.id ?? null) : defaultRobotId;
    try {
      await onChange(remaining, nextDefault);
    } catch (error) {
      setStatus(String(error));
      return;
    }
    if (selected?.id === robot.id) {
      const index = robots.findIndex((item) => item.id === robot.id);
      setSelectedId((remaining[index] ?? remaining[index - 1])?.id ?? null);
      setInvalidField(null);
    }
    setDrafts((previous) => {
      const retained = { ...previous };
      delete retained[robot.id];
      return retained;
    });
    setStatus(`已删除“${robot.name}”，已有聊天记录仍然保留。`);
  }

  return (
    <section
      className={styles.page}
      aria-label="机器人配置"
      ref={setPortalContainer}
    >
      <aside className={styles.roster}>
        <header className={styles.listHeading}>
          <div>
            <h2>机器人</h2>
            <span>{robots.length} 个机器人</span>
          </div>
          <button
            type="button"
            className={styles.addButton}
            aria-label="新建机器人"
            onClick={addRobot}
            disabled={disabled}
          >
            <Plus aria-hidden="true" />
          </button>
        </header>
        <div className={styles.list} aria-label="机器人列表">
          {robots.map((robot) => (
            <ContextMenu.Root key={robot.id}>
              <ContextMenu.Trigger asChild disabled={disabled}>
                <button
                  type="button"
                  className={styles.robotCard}
                  aria-label={robot.name}
                  aria-pressed={robot.id === selected?.id}
                  disabled={disabled}
                  onClick={() => {
                    // 草稿按机器人分别保留，切换条目或配置页签不会丢失未保存的输入。
                    setSelectedId(robot.id);
                    setInvalidField(null);
                    setStatus("");
                  }}
                >
                  <span className={styles.avatar}>
                    <RobotAvatar icon={robot.icon} />
                  </span>
                  <span className={styles.cardCopy}>
                    <span className={styles.cardName}>
                      <span>{robot.name}</span>
                      {robot.id === defaultRobotId && (
                        <span className={styles.defaultBadge}>默认</span>
                      )}
                    </span>
                    <span className={styles.cardDescription}>
                      {aiSettings?.enabled
                        ? resolveRobotAi(robot, aiSettings).label
                        : "AI 未配置"}
                    </span>
                    {isRobotModified(robot, drafts[robot.id]) && (
                      <span className={styles.draftHint}>有未保存的修改</span>
                    )}
                  </span>
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal container={portalContainer}>
                <ContextMenu.Content
                  className={styles.contextMenu}
                  collisionPadding={12}
                  aria-label={`${robot.name}的操作`}
                >
                  <ContextMenu.Item
                    className={styles.menuItem}
                    disabled={disabled || robot.id === defaultRobotId}
                    onSelect={async () => {
                      try {
                        await onChange(robots, robot.id);
                      } catch (error) {
                        setStatus(String(error));
                        return;
                      }
                      setStatus(
                        `已将“${robot.name}”设为默认，新对话将使用它。`,
                      );
                    }}
                  >
                    <Star aria-hidden="true" />
                    设为默认
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={styles.menuItem}
                    disabled={disabled}
                    onSelect={() => copyRobot(robot)}
                  >
                    <Copy aria-hidden="true" />
                    复制
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={styles.menuSeparator} />
                  <ContextMenu.Item
                    className={`${styles.menuItem} ${styles.deleteItem}`}
                    disabled={disabled}
                    onSelect={() => deleteRobot(robot)}
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      </aside>

      {draft ? (
        <div className={styles.editor}>
          <header className={styles.robotHeading}>
            <span className={styles.headingAvatar}>
              <RobotAvatar icon={draft.icon} />
            </span>
            <div className={styles.headingCopy}>
              <h1>{draft.name || "未命名机器人"}</h1>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled || removed}
              title="保存当前配置并新建对话"
              onClick={async () => {
                const saved = await saveRobot();
                // 同时传递保存后的配置，父页面可以在一次更新中创建对应会话。
                if (saved)
                  try {
                    await onUse(saved);
                  } catch (error) {
                    setStatus(String(error));
                  }
              }}
            >
              使用此机器人
            </button>
          </header>
          <Tabs.Root
            className={styles.tabsRoot}
            value={tab}
            onValueChange={setTab}
          >
            <Tabs.List className={styles.tabs} aria-label="机器人配置分类">
              <Tabs.Trigger
                type="button"
                className={styles.tab}
                value="persona"
              >
                角色设定
              </Tabs.Trigger>
              <Tabs.Trigger type="button" className={styles.tab} value="model">
                AI 配置
              </Tabs.Trigger>
              <Tabs.Trigger type="button" className={styles.tab} value="memory">
                记忆与能力
              </Tabs.Trigger>
            </Tabs.List>
            <div className={styles.fields}>
              <fieldset className={styles.fieldset} disabled={disabled}>
                <Tabs.Content value="persona" className={styles.panel}>
                  <label className={styles.field}>
                    名称
                    <input
                      ref={nameInput}
                      value={draft.name}
                      maxLength={24}
                      aria-invalid={invalidField === "name"}
                      onChange={(event) =>
                        updateDraft("name", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    角色指令
                    <textarea
                      ref={promptInput}
                      value={draft.prompt}
                      rows={9}
                      maxLength={1600}
                      aria-invalid={invalidField === "prompt"}
                      onChange={(event) =>
                        updateDraft("prompt", event.target.value)
                      }
                    />
                  </label>
                  <p className={styles.hint}>
                    定义它的性格、讲解方式，以及遇到不确定问题时应如何回应。
                  </p>
                </Tabs.Content>
                <Tabs.Content value="model" className={styles.panel}>
                  <RobotAiFields
                    config={draft.aiDefaults}
                    settings={aiSettings}
                    disabled={disabled}
                    onChange={(config) =>
                      setDraft({ ...draft, aiDefaults: config })
                    }
                  />
                </Tabs.Content>
                <Tabs.Content value="memory" className={styles.panel}>
                  <h3 className={styles.sectionTitle}>记忆</h3>
                  <label className={styles.checkField}>
                    <input
                      type="checkbox"
                      checked={draft.memoryEnabled}
                      onChange={(event) =>
                        updateDraft("memoryEnabled", event.target.checked)
                      }
                    />
                    <span>
                      独立学习记忆
                      <small>每个机器人分别保留学习偏好和讨论要点。</small>
                    </span>
                  </label>
                  <label className={styles.checkField}>
                    <input
                      type="checkbox"
                      checked={draft.courseMemory}
                      onChange={(event) =>
                        updateDraft("courseMemory", event.target.checked)
                      }
                    />
                    <span>
                      参考课程记忆
                      <small>使用当前学科的知识要点和讨论主题。</small>
                    </span>
                  </label>
                  <h3 className={styles.sectionTitle}>能力</h3>
                  {skills.map(({ value, label }) => (
                    <label className={styles.checkField} key={value}>
                      <input
                        type="checkbox"
                        checked={draft.skills.includes(value)}
                        onChange={(event) =>
                          updateDraft(
                            "skills",
                            event.target.checked
                              ? [...draft.skills, value]
                              : draft.skills.filter((skill) => skill !== value),
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </Tabs.Content>
              </fieldset>
            </div>
          </Tabs.Root>
          <footer className={styles.footer}>
            <p
              className={invalidField ? styles.error : styles.status}
              role={invalidField ? "alert" : "status"}
            >
              {removed
                ? "机器人已删除，当前输入仍保留，可从“未保存内容”中复制。"
                : hasChanges && !invalidField
                  ? "有未保存的修改"
                  : status}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={disabled}
                onClick={restoreDefaults}
              >
                恢复默认
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={disabled || !hasChanges}
                onClick={cancelChanges}
              >
                取消修改
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={disabled || removed || !hasChanges}
                onClick={saveRobot}
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
            </div>
            <p className={styles.footerHint}>
              角色指令和模型用于实际对话；记忆与能力选项目前仅保存配置。
            </p>
          </footer>
        </div>
      ) : (
        <div className={styles.empty}>
          <h2>还没有机器人</h2>
          <p>新建一个机器人，设置它的交流方式和能力。</p>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={disabled}
            onClick={addRobot}
          >
            新建机器人
          </button>
          <p className={styles.emptyStatus} role="status">
            {status}
          </p>
        </div>
      )}
    </section>
  );
}
