import { useRef, useState } from "react";
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
  activeRobotId: string | null;
  onChange: (robots: Robot[], defaultRobotId: string | null) => void;
  onUse: (robot: Robot) => void;
  disabled?: boolean;
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
  activeRobotId,
  onChange,
  onUse,
  disabled = false,
}: RobotsPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    robots[0]?.id ?? null,
  );
  const [drafts, setDrafts] = useState<Record<string, Robot>>({});
  const [status, setStatus] = useState("");
  const [invalidField, setInvalidField] = useState<"name" | "prompt" | null>(
    null,
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [tab, setTab] = useState("persona");
  const nameInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);

  const selected = robots.find((robot) => robot.id === selectedId) ?? robots[0];
  const draft = selected ? (drafts[selected.id] ?? selected) : undefined;
  const hasChanges = !!selected && isRobotModified(selected, draft);

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

  function addRobot() {
    const robot = createRobot();
    onChange([...robots, robot], defaultRobotId ?? robot.id);
    setSelectedId(robot.id);
    setTab("persona");
    setInvalidField(null);
    setStatus("已新建机器人，可以修改它的配置。");
  }

  function saveRobot(): Robot | null {
    if (!draft) return null;
    const next = {
      ...draft,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      modelName: draft.modelName.trim(),
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
    onChange(
      robots.map((robot) => (robot.id === next.id ? next : robot)),
      defaultRobotId,
    );
    setDrafts((previous) => {
      const remaining = { ...previous };
      delete remaining[next.id];
      return remaining;
    });
    setInvalidField(null);
    setStatus("配置已更新。");
    return next;
  }

  function copyRobot(robot: Robot) {
    const base = robot.name.slice(0, 16);
    let name = `${base}（副本）`;
    let number = 2;
    while (robots.some((item) => item.name === name))
      name = `${base}（副本 ${number++}）`;
    const copy = {
      ...robot,
      id: crypto.randomUUID(),
      name,
      skills: [...robot.skills],
    };
    onChange([...robots, copy], defaultRobotId);
    setSelectedId(copy.id);
    setInvalidField(null);
    setStatus(`已复制“${robot.name}”的已保存配置。`);
  }

  function deleteRobot(robot: Robot) {
    const remaining = robots.filter((item) => item.id !== robot.id);
    const nextDefault =
      defaultRobotId === robot.id ? (remaining[0]?.id ?? null) : defaultRobotId;
    onChange(remaining, nextDefault);
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
                    {robot.id === activeRobotId && (
                      <span className={styles.cardDescription}>当前使用</span>
                    )}
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
                    onSelect={() => {
                      onChange(robots, robot.id);
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
              disabled={disabled}
              title="保存当前配置并新建对话"
              onClick={() => {
                const saved = saveRobot();
                // 同时传递保存后的配置，父页面可以在一次更新中创建对应会话。
                if (saved) onUse(saved);
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
                模型设置
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
                  <label className={styles.field}>
                    模型来源
                    <select
                      value={draft.modelSource}
                      onChange={(event) =>
                        updateDraft(
                          "modelSource",
                          event.target.value === "custom" ? "custom" : "global",
                        )
                      }
                    >
                      <option value="global">跟随全局模型设置</option>
                      <option value="custom">为这个机器人单独配置</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    模型名称
                    <input
                      value={draft.modelName}
                      maxLength={100}
                      placeholder={
                        draft.modelSource === "global"
                          ? "使用全局模型"
                          : "填写模型标识，例如 provider/model"
                      }
                      disabled={draft.modelSource === "global"}
                      onChange={(event) =>
                        updateDraft("modelName", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.rangeLabel}>
                      回答发散度 <output>{draft.temperature.toFixed(1)}</output>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={draft.temperature}
                      onChange={(event) =>
                        updateDraft("temperature", Number(event.target.value))
                      }
                    />
                  </label>
                  <p className={styles.hint}>
                    较低时更稳定，较高时表达更多样。具体效果取决于所接入的模型。
                  </p>
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
              {status || (hasChanges ? "有未保存的修改" : "")}
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
                disabled={disabled || !hasChanges}
                onClick={saveRobot}
              >
                保存配置
              </button>
            </div>
            <p className={styles.footerHint}>
              AI 与长期记忆功能尚未接入，以上选项当前仅保存配置。
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
