import { useState } from "react";
import { Popover } from "radix-ui";
import {
  BookOpen,
  Bot,
  ChevronDown,
  CircleHelp,
  Code2,
  Cpu,
  Download,
  Library,
  LogOut,
  MessagesSquare,
  Moon,
  NotebookPen,
  PawPrint,
  Settings as SettingsIcon,
  SlidersHorizontal,
  SquareFunction,
  Sun,
  UserRoundPlus,
} from "lucide-react";
import type {
  CourseId,
  ReadingSelection,
  Settings,
} from "@solvemate/contracts";
import userAvatar from "../assets/user-avatar.png";
import styles from "./Sidebar.module.css";

type View = "reading" | "conversations" | "notes" | "robots" | "content";

interface SidebarProps {
  subjects: { id: CourseId; title: string }[];
  view: View;
  selection: ReadingSelection;
  settings: Settings;
  onNavigate: (view: View) => void;
  onSelectContent: (
    courseId: CourseId,
    kind: "questions" | "textbooks",
  ) => void;
  onSettingsChange: (settings: Settings) => void;
  disabled?: boolean;
}

const accountActions = [
  {
    name: "虚拟宠物",
    description: "学习路上的小伙伴",
    icon: PawPrint,
    message: "虚拟宠物功能尚未开放。",
  },
  {
    name: "邀请好友",
    description: "邀请朋友一起学习",
    icon: UserRoundPlus,
    message: "邀请好友功能尚未开放。",
  },
  {
    name: "帮助",
    description: "使用说明与常见问题",
    icon: CircleHelp,
    message:
      "从学科中选择教材或题目即可开始阅读。学习记录保存在当前浏览器中。AI 服务尚未接入。",
  },
  {
    name: "退出登录",
    description: "",
    icon: LogOut,
    message: "当前使用本地数据，没有已登录的账号。",
  },
];

export function Sidebar({
  subjects,
  view,
  selection,
  settings,
  onNavigate,
  onSelectContent,
  onSettingsChange,
  disabled = false,
}: SidebarProps) {
  const [subjectsOpen, setSubjectsOpen] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState<
    Record<CourseId, boolean>
  >({ calculus: true, "c-language": true });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<
    "display" | "model" | null
  >(null);

  function toggleSubjects() {
    // 收起总入口时同时收起课程，避免再次展开时恢复旧的子树状态。
    if (subjectsOpen)
      setExpandedSubjects(
        Object.fromEntries(subjects.map((subject) => [subject.id, false])),
      );
    setSubjectsOpen(!subjectsOpen);
  }

  function navigate(nextView: View) {
    setAccountOpen(false);
    setSettingsOpen(false);
    onNavigate(nextView);
  }

  return (
    <nav className={styles.sidebar} aria-label="功能菜单">
      <Popover.Root
        open={accountOpen}
        onOpenChange={(open) => {
          setAccountOpen(open);
          if (open) setAccountMessage("");
        }}
      >
        <Popover.Trigger
          className={styles.avatarButton}
          aria-label="用户菜单"
          disabled={disabled}
        >
          <img className={styles.avatarImage} src={userAvatar} alt="" />
        </Popover.Trigger>
        <Popover.Content
          className={`${styles.popover} ${styles.accountMenu}`}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          aria-label="用户账户"
        >
          <div className={styles.accountName}>
            <span className={styles.accountAvatar}>
              <img className={styles.avatarImage} src={userAvatar} alt="" />
            </span>
            <span>mumumeow</span>
          </div>
          {[accountActions.slice(0, 2), accountActions.slice(2)].map(
            (group, index) => (
              <div
                className={styles.accountGroup}
                role="group"
                aria-label={index === 0 ? "用户功能" : "帮助与登录"}
                key={index}
              >
                {group.map(({ name, description, icon: Icon, message }) => (
                  <button
                    key={name}
                    className={styles.accountItem}
                    type="button"
                    onClick={() => setAccountMessage(message)}
                  >
                    <span className={styles.accountIcon}>
                      <Icon aria-hidden="true" />
                    </span>
                    <span className={styles.accountCopy}>
                      <span className={styles.accountTitle}>{name}</span>
                      {description && (
                        <span className={styles.accountDescription}>
                          {description}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ),
          )}
          {accountMessage && (
            <p className={styles.accountMessage} role="status">
              {accountMessage}
            </p>
          )}
          <Popover.Arrow className={styles.arrow} width={12} height={6} />
        </Popover.Content>
      </Popover.Root>

      <div className={styles.subjects}>
        <button
          className={styles.primaryButton}
          type="button"
          aria-expanded={subjectsOpen}
          aria-controls="subject-navigation"
          disabled={disabled}
          onClick={toggleSubjects}
        >
          <Library aria-hidden="true" />
          <span>学科</span>
          <ChevronDown
            aria-hidden="true"
            className={styles.chevron}
            data-open={subjectsOpen}
          />
        </button>
        {subjectsOpen && (
          <div id="subject-navigation" className={styles.subjectTree}>
            {subjects.map((subject) => (
              <div className={styles.subjectBranch} key={subject.id}>
                <button
                  className={styles.subjectButton}
                  type="button"
                  aria-expanded={!!expandedSubjects[subject.id]}
                  aria-controls={`course-${subject.id}`}
                  disabled={disabled}
                  onClick={() =>
                    setExpandedSubjects({
                      ...expandedSubjects,
                      [subject.id]: !expandedSubjects[subject.id],
                    })
                  }
                >
                  <span>{subject.title}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={styles.chevron}
                    data-open={expandedSubjects[subject.id]}
                  />
                </button>
                {expandedSubjects[subject.id] && (
                  <div
                    className={styles.subjectLeaves}
                    id={`course-${subject.id}`}
                  >
                    <button
                      className={styles.contentButton}
                      type="button"
                      aria-pressed={
                        view === "reading" &&
                        selection.courseId === subject.id &&
                        selection.kind === "textbooks"
                      }
                      disabled={disabled}
                      onClick={() => onSelectContent(subject.id, "textbooks")}
                    >
                      <BookOpen aria-hidden="true" />
                      <span>教材</span>
                    </button>
                    <button
                      className={styles.contentButton}
                      type="button"
                      aria-pressed={
                        view === "reading" &&
                        selection.courseId === subject.id &&
                        selection.kind === "questions"
                      }
                      disabled={disabled}
                      onClick={() => onSelectContent(subject.id, "questions")}
                    >
                      {subject.id === "calculus" ? (
                        <SquareFunction aria-hidden="true" />
                      ) : (
                        <Code2 aria-hidden="true" />
                      )}
                      <span>题目</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className={styles.primaryButton}
        type="button"
        aria-pressed={view === "conversations"}
        disabled={disabled}
        onClick={() => navigate("conversations")}
      >
        <MessagesSquare aria-hidden="true" />
        <span>对话</span>
      </button>
      <button
        className={styles.primaryButton}
        type="button"
        aria-pressed={view === "notes"}
        disabled={disabled}
        onClick={() => navigate("notes")}
      >
        <NotebookPen aria-hidden="true" />
        <span>笔记</span>
      </button>
      <button
        className={styles.primaryButton}
        type="button"
        aria-pressed={view === "robots"}
        disabled={disabled}
        onClick={() => navigate("robots")}
      >
        <Bot aria-hidden="true" />
        <span>机器人</span>
      </button>

      <div className={styles.settings}>
        <Popover.Root
          open={settingsOpen}
          onOpenChange={(open) => {
            setSettingsOpen(open);
            if (!open) setSettingsPanel(null);
          }}
        >
          <Popover.Trigger
            className={styles.primaryButton}
            aria-label="设置"
            disabled={disabled}
          >
            <SettingsIcon aria-hidden="true" />
            <span>设置</span>
          </Popover.Trigger>
          <Popover.Content
            className={`${styles.popover} ${styles.settingsMenu}`}
            side="right"
            align="end"
            sideOffset={12}
            collisionPadding={12}
            aria-label="设置选项"
          >
            <button
              className={styles.settingsItem}
              onClick={() => navigate("content")}
            >
              <Download aria-hidden="true" />
              <span>官方内容</span>
            </button>
            <Popover.Root
              open={settingsPanel === "display"}
              onOpenChange={(open) => setSettingsPanel(open ? "display" : null)}
            >
              <Popover.Trigger className={styles.settingsItem}>
                <SlidersHorizontal aria-hidden="true" />
                <span>显示设置</span>
              </Popover.Trigger>
              <Popover.Content
                className={`${styles.popover} ${styles.settingsPanel}`}
                side="right"
                align="end"
                sideOffset={12}
                collisionPadding={12}
                aria-labelledby="display-settings-heading"
              >
                <h3 id="display-settings-heading">显示设置</h3>
                <div className={styles.settingLabel}>
                  <label htmlFor="reading-font-size">阅读字号</label>
                  <output htmlFor="reading-font-size">
                    {settings.fontSize}px
                  </output>
                </div>
                <input
                  id="reading-font-size"
                  aria-label="阅读字号"
                  type="range"
                  min={12}
                  max={21}
                  step={1}
                  value={settings.fontSize}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      fontSize: Number(event.target.value),
                    })
                  }
                />
                <fieldset className={styles.appearance}>
                  <legend>外观</legend>
                  <div className={styles.appearanceOptions}>
                    <button
                      className={styles.appearanceButton}
                      type="button"
                      aria-pressed={settings.appearance === "light"}
                      onClick={() =>
                        onSettingsChange({ ...settings, appearance: "light" })
                      }
                    >
                      <Sun aria-hidden="true" />
                      <span>白天模式</span>
                    </button>
                    <button
                      className={styles.appearanceButton}
                      type="button"
                      aria-pressed={settings.appearance === "dark"}
                      onClick={() =>
                        onSettingsChange({ ...settings, appearance: "dark" })
                      }
                    >
                      <Moon aria-hidden="true" />
                      <span>夜间模式</span>
                    </button>
                  </div>
                </fieldset>
                <Popover.Arrow className={styles.arrow} width={12} height={6} />
              </Popover.Content>
            </Popover.Root>
            <Popover.Root
              open={settingsPanel === "model"}
              onOpenChange={(open) => setSettingsPanel(open ? "model" : null)}
            >
              <Popover.Trigger className={styles.settingsItem}>
                <Cpu aria-hidden="true" />
                <span>模型设置</span>
              </Popover.Trigger>
              <Popover.Content
                className={`${styles.popover} ${styles.settingsPanel}`}
                side="right"
                align="end"
                sideOffset={12}
                collisionPadding={12}
                aria-labelledby="model-settings-heading"
              >
                <h3 id="model-settings-heading">模型设置</h3>
                <label className={styles.settingLabel} htmlFor="global-model">
                  当前模型
                </label>
                <select
                  id="global-model"
                  disabled
                  className={styles.modelSelect}
                >
                  <option>尚未接入模型</option>
                </select>
                <p className={styles.settingNote}>
                  AI 服务接入后，可在这里选择全局模型。
                </p>
                <Popover.Arrow className={styles.arrow} width={12} height={6} />
              </Popover.Content>
            </Popover.Root>
            <Popover.Arrow className={styles.arrow} width={12} height={6} />
          </Popover.Content>
        </Popover.Root>
      </div>
    </nav>
  );
}
