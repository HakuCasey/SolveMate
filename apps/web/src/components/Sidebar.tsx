import { PopoverPanel } from "./PopoverPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, Popover } from "radix-ui";
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
  Pencil,
  Plus,
  School,
  Trash2,
  Settings as SettingsIcon,
  SlidersHorizontal,
  SquareFunction,
  Sun,
  UserRoundPlus,
} from "lucide-react";
import type { CourseId, Settings, Robot, Subject } from "@solvemate/contracts";
import type { LibraryScope } from "../reading/library";
import { teachingActivities, type TeachingActivityId } from "../data/teaching";
import type { AiService } from "../ai/useAiService";
import { RobotAiConfiguration } from "./RobotAiConfiguration";
import type { RobotAiConfig } from "../ai/robot-config";
import { AiSettings } from "./AiSettings";
import { StudyFootprint, StudyMedals, StudyTitle } from "./StudyOverview";
import type { SubjectAction } from "./SubjectDialog";
import userAvatar from "../assets/user-avatar.png";
import styles from "./Sidebar.module.css";

type View =
  | "reading"
  | "conversations"
  | "notes"
  | "teaching"
  | "robots"
  | "content"
  | "materials"
  | "library";

interface SidebarProps {
  subjects: Subject[];
  onSubjectAction: (action: SubjectAction) => void;
  view: View;
  teachingActivity: TeachingActivityId;
  onSelectTeachingActivity: (id: TeachingActivityId) => void;
  activeScope: LibraryScope | null;
  settings: Settings;
  onNavigate: (view: View) => void;
  onSelectContent: (
    courseId: CourseId | null,
    kind: "questions" | "textbooks",
  ) => void;
  onSettingsChange: (settings: Settings) => void;
  disabled?: boolean;
  ai: AiService;
  robot: Robot | undefined;
  robotAiConfig: RobotAiConfig;
  onRobotAiSave: (config: RobotAiConfig) => Promise<void>;
  aiSettingsSource: "chat" | "sidebar" | null;
  onAiSettingsSourceChange: (source: "chat" | "sidebar" | null) => void;
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
      "从学科中选择学习资料或题目，再从列表打开内容。学习记录保存在当前浏览器中。AI 连接可在“设置 → AI 配置”中配置。",
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
  teachingActivity,
  onSelectTeachingActivity,
  activeScope,
  onSubjectAction,
  settings,
  onNavigate,
  onSelectContent,
  onSettingsChange,
  disabled = false,
  ai,
  robot,
  onRobotAiSave,
  robotAiConfig,
  aiSettingsSource,
  onAiSettingsSourceChange,
}: SidebarProps) {
  const [compactSettings, setCompactSettings] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const changed = () => setCompactSettings(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [teachingOpen, setTeachingOpen] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<
    Record<CourseId, boolean>
  >({});
  const activeSubject = activeScope
    ? (activeScope.courseId ?? "__unclassified__")
    : null;
  const subjectTree = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeSubject === null) return;
    setSubjectsOpen(true);
    setExpandedSubjects((previous) =>
      previous[activeSubject]
        ? previous
        : { ...previous, [activeSubject]: true },
    );
  }, [activeSubject]);
  useEffect(() => {
    const tree = subjectTree.current;
    const item = tree?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!tree || !item) return;
    const bounds = tree.getBoundingClientRect(),
      target = item.getBoundingClientRect();
    if (target.top < bounds.top) tree.scrollTop -= bounds.top - target.top;
    else if (target.bottom > bounds.bottom)
      tree.scrollTop += target.bottom - bounds.bottom;
  }, [activeSubject, subjectsOpen, expandedSubjects]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelSettingsOpen = aiSettingsSource !== null;
  const [settingsPanel, setSettingsPanel] = useState<"display" | null>(null);

  const modelTrigger = useRef<HTMLButtonElement>(null);
  const modelReturnFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (aiSettingsSource)
      modelReturnFocus.current =
        aiSettingsSource === "sidebar"
          ? modelTrigger.current
          : document.querySelector<HTMLButtonElement>(
              '[aria-label="打开 AI 配置"]',
            );
  }, [aiSettingsSource]);
  // 窄屏在视口顶部显示；桌面端从聊天栏打开时，以可见入口定位。
  const modelAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        if (compactSettings) return new DOMRect(window.innerWidth / 2, 0, 0, 0);
        const element =
          aiSettingsSource === "sidebar"
            ? modelTrigger.current
            : document.querySelector('[aria-label="打开 AI 配置"]');
        return element?.getBoundingClientRect() ?? new DOMRect(12, 12, 0, 0);
      },
    }),
    [aiSettingsSource, compactSettings],
  );

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
    setSettingsPanel(null);
    onAiSettingsSourceChange(null);
    onNavigate(nextView);
  }

  return (
    <nav className={styles.sidebar} aria-label="功能菜单">
      <div className={styles.profile}>
        <div className={styles.profileRow}>
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
            <PopoverPanel
              className={styles.popover}
              width={256}
              padding={7}
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
            </PopoverPanel>
          </Popover.Root>
          <StudyMedals />
        </div>
        <StudyTitle />
      </div>

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
          <div
            id="subject-navigation"
            className={styles.subjectTree}
            ref={subjectTree}
          >
            {subjects.map((subject) => (
              <div className={styles.subjectBranch} key={subject.id}>
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
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
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className={styles.subjectMenu}>
                      <ContextMenu.Item
                        disabled={disabled}
                        onSelect={() =>
                          onSubjectAction({ kind: "rename", subject })
                        }
                      >
                        <Pencil aria-hidden="true" />
                        重命名
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        disabled={disabled}
                        className={styles.deleteSubject}
                        onSelect={() =>
                          onSubjectAction({ kind: "delete", subject })
                        }
                      >
                        <Trash2 aria-hidden="true" />
                        删除
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
                {expandedSubjects[subject.id] && (
                  <div
                    className={styles.subjectLeaves}
                    id={`course-${subject.id}`}
                  >
                    <button
                      className={styles.contentButton}
                      type="button"
                      aria-pressed={
                        activeScope?.courseId === subject.id &&
                        activeScope.kind === "textbooks"
                      }
                      disabled={disabled}
                      onClick={() => onSelectContent(subject.id, "textbooks")}
                    >
                      <BookOpen aria-hidden="true" />
                      <span>学习资料</span>
                    </button>
                    <button
                      className={styles.contentButton}
                      type="button"
                      aria-pressed={
                        activeScope?.courseId === subject.id &&
                        activeScope.kind === "questions"
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
            <div className={styles.subjectBranch}>
              <button
                className={styles.subjectButton}
                type="button"
                aria-expanded={!!expandedSubjects.__unclassified__}
                aria-controls="course-unclassified"
                onClick={() =>
                  setExpandedSubjects((previous) => ({
                    ...previous,
                    __unclassified__: !previous.__unclassified__,
                  }))
                }
              >
                未分类
                <ChevronDown
                  aria-hidden="true"
                  className={styles.chevron}
                  data-open={expandedSubjects.__unclassified__}
                />
              </button>
              {expandedSubjects.__unclassified__ && (
                <div className={styles.subjectLeaves} id="course-unclassified">
                  <button
                    className={styles.contentButton}
                    type="button"
                    aria-pressed={
                      activeScope?.courseId === null &&
                      activeScope.kind === "textbooks"
                    }
                    disabled={disabled}
                    onClick={() => onSelectContent(null, "textbooks")}
                  >
                    <BookOpen aria-hidden="true" />
                    <span>学习资料</span>
                  </button>
                </div>
              )}
            </div>
            <button
              className={styles.addSubject}
              disabled={disabled}
              onClick={() => onSubjectAction({ kind: "create" })}
            >
              <Plus aria-hidden="true" />
              新增学科
            </button>
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
      <div className={styles.teaching}>
        <button
          className={styles.primaryButton}
          type="button"
          aria-expanded={teachingOpen}
          aria-controls="teaching-navigation"
          aria-pressed={view === "teaching"}
          disabled={disabled}
          onClick={() => setTeachingOpen((open) => !open)}
        >
          <School aria-hidden="true" />
          <span>教研室</span>
          <ChevronDown
            className={styles.chevron}
            data-open={teachingOpen}
            aria-hidden="true"
          />
        </button>
        {teachingOpen && (
          <div
            id="teaching-navigation"
            className={styles.subjectLeaves}
            role="group"
            aria-label="教研室功能"
          >
            {teachingActivities.map((activity) => (
              <button
                key={activity.id}
                type="button"
                className={styles.contentButton}
                disabled={disabled}
                aria-pressed={
                  view === "teaching" && teachingActivity === activity.id
                }
                onClick={() => {
                  navigate("teaching");
                  onSelectTeachingActivity(activity.id);
                }}
              >
                <span>{activity.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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

      <div className={styles.bottom}>
        <StudyFootprint />
        <div className={styles.settings}>
          <Popover.Root
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open);
              if (!open) {
                setSettingsPanel(null);
                if (aiSettingsSource === "sidebar")
                  onAiSettingsSourceChange(null);
              }
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
            <PopoverPanel
              className={styles.popover}
              width={190}
              padding={7}
              side="right"
              align="end"
              sideOffset={12}
              collisionPadding={12}
              aria-label="设置选项"
              onOpenAutoFocus={(event) => {
                if (modelSettingsOpen) event.preventDefault();
              }}
              onInteractOutside={(event) => {
                // 二级气泡通过 Portal 显示，一级菜单不应把其中的交互当成外部点击。
                if (
                  modelSettingsOpen &&
                  event.target instanceof Element &&
                  event.target.closest(
                    '[aria-labelledby="ai-settings-heading"], [data-settings-select], [data-connection-delete-dialog]',
                  )
                )
                  event.preventDefault();
              }}
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
                onOpenChange={(open) => {
                  setSettingsPanel(open ? "display" : null);
                  if (open) onAiSettingsSourceChange(null);
                }}
              >
                <Popover.Trigger className={styles.settingsItem}>
                  <SlidersHorizontal aria-hidden="true" />
                  <span>显示设置</span>
                </Popover.Trigger>
                <PopoverPanel
                  className={`${styles.popover} ${styles.settingsPanel}`}
                  title="显示设置"
                  icon={SlidersHorizontal}
                  titleId="display-settings-heading"
                  width={236}
                  side="right"
                  align="end"
                  sideOffset={12}
                  collisionPadding={12}
                  aria-labelledby="display-settings-heading"
                >
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
                </PopoverPanel>
              </Popover.Root>
              <button
                ref={modelTrigger}
                className={styles.settingsItem}
                aria-haspopup="dialog"
                aria-expanded={aiSettingsSource === "sidebar"}
                aria-controls={
                  aiSettingsSource === "sidebar"
                    ? "ai-settings-popover"
                    : undefined
                }
                onClick={() => {
                  setSettingsPanel(null);
                  onAiSettingsSourceChange(
                    aiSettingsSource === "sidebar" ? null : "sidebar",
                  );
                }}
              >
                <Cpu aria-hidden="true" />
                <span>AI 配置</span>
              </button>
            </PopoverPanel>
          </Popover.Root>
          {/* AI 气泡独立于设置菜单，聊天栏入口无需展开一级菜单。 */}
          <Popover.Root
            open={modelSettingsOpen}
            onOpenChange={(open) => {
              if (!open) onAiSettingsSourceChange(null);
            }}
          >
            <Popover.Anchor virtualRef={{ current: modelAnchor }} />
            <Popover.Portal>
              <PopoverPanel
                className={styles.popover}
                title="AI 配置"
                icon={Cpu}
                titleId="ai-settings-heading"
                width={360}
                side={compactSettings ? "bottom" : "right"}
                align={compactSettings ? "center" : "end"}
                sticky="always"
                id="ai-settings-popover"
                onOpenAutoFocus={() => {
                  modelReturnFocus.current =
                    aiSettingsSource === "sidebar"
                      ? modelTrigger.current
                      : document.querySelector<HTMLButtonElement>(
                          '[aria-label="打开 AI 配置"]',
                        );
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  const target = modelReturnFocus.current;
                  if (target?.isConnected)
                    target.focus({ preventScroll: true });
                  else if (target)
                    document
                      .querySelector<HTMLButtonElement>('[aria-label="设置"]')
                      ?.focus({ preventScroll: true });
                }}
                sideOffset={12}
                collisionPadding={12}
                aria-labelledby="ai-settings-heading"
                onInteractOutside={(event) => {
                  // 下拉选项和删除确认框位于独立 Portal，交互时保留 AI 配置气泡。
                  if (
                    event.target instanceof Element &&
                    (event.target.closest("[data-settings-select]") ||
                      event.target.closest("[data-connection-delete-dialog]") ||
                      event.target.closest('[aria-label="打开 AI 配置"]') ||
                      modelTrigger.current?.contains(event.target))
                  )
                    event.preventDefault();
                  else modelReturnFocus.current = null;
                }}
              >
                {aiSettingsSource === "chat" ? (
                  robot ? (
                    <RobotAiConfiguration
                      key={robot.id}
                      robot={robot}
                      saved={robotAiConfig}
                      settings={ai.settings}
                      onSave={onRobotAiSave}
                    />
                  ) : (
                    <p>请选择机器人。</p>
                  )
                ) : (
                  <AiSettings
                    key={ai.settings ? "ready" : "loading"}
                    settings={ai.settings}
                    serviceError={ai.error}
                    onRefresh={ai.refresh}
                    onSaved={(next) => {
                      ai.setSettings(next);
                    }}
                  />
                )}
              </PopoverPanel>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    </nav>
  );
}
