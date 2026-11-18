import { PopoverPanel } from "./PopoverPanel";
import { useState, type CSSProperties } from "react";
import { Popover } from "radix-ui";
import {
  ArchiveRestore,
  Bot,
  Check,
  CircleHelp,
  Cpu,
  Download,
  Library,
  LogOut,
  MessagesSquare,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PawPrint,
  School,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sun,
  UserRoundPlus,
} from "lucide-react";
import type { Settings } from "@solvemate/contracts";
import type { AiService } from "../ai/useAiService";
import { AiSettings } from "./AiSettings";
import { StudyFootprint, StudyAchievements } from "./StudyOverview";
import userAvatar from "../assets/user-avatar.png";
import { findTheme, themes } from "../theme/presets";
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
  onOpenBackup: () => void;
  view: View;
  settings: Settings;
  onNavigate: (view: View) => void;
  onSettingsChange: (settings: Settings) => void;
  disabled?: boolean;
  ai: AiService;
}

const navigationItems = [
  { view: "library", label: "学科", icon: Library },
  { view: "conversations", label: "对话", icon: MessagesSquare },
  { view: "notes", label: "笔记", icon: NotebookPen },
  { view: "teaching", label: "教研室", icon: School },
  { view: "robots", label: "机器人", icon: Bot },
] as const;

const sidebarPreference = "solvemate.sidebarCollapsed";

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
      "从学科中选择学习资料或题目，再从列表打开内容。学习记录保存在本机，浏览器保留缓存。AI 连接可在“设置 → AI 配置”中配置。",
  },
  {
    name: "退出登录",
    description: "",
    icon: LogOut,
    message: "当前使用本地数据，没有已登录的账号。",
  },
];

export function Sidebar({
  onOpenBackup,
  view,
  settings,
  onNavigate,
  onSettingsChange,
  disabled = false,
  ai,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarPreference) === "true";
    } catch {
      return false;
    }
  });
  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏";

  function toggleSidebar() {
    setCollapsed(!collapsed);
    try {
      window.localStorage.setItem(sidebarPreference, String(!collapsed));
    } catch {
      // 浏览器禁用本地存储时，仍可在当前窗口切换布局。
    }
  }

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [settingsMenu, setSettingsMenu] = useState<
    "closed" | "menu" | "display" | "ai"
  >("closed");
  const settingsOpen = settingsMenu !== "closed";
  const settingsPanel =
    settingsMenu === "display" || settingsMenu === "ai" ? settingsMenu : null;
  const modelSettingsOpen = settingsPanel === "ai";

  function setSettingsOpen(open: boolean) {
    setSettingsMenu(open ? "menu" : "closed");
  }

  // 菜单与子气泡共用一个状态；迟到的关闭事件不能关闭另一个气泡或重开菜单。
  function setSettingsPanel(panel: "display" | "ai", open: boolean) {
    setSettingsMenu((current) => {
      if (current === "closed") return current;
      return open ? panel : current === panel ? "menu" : current;
    });
  }

  function navigate(nextView: View) {
    setAccountOpen(false);
    setSettingsOpen(false);
    onNavigate(nextView);
  }

  return (
    <nav
      className={styles.sidebar}
      data-collapsed={collapsed}
      aria-label="功能菜单"
    >
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
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={!collapsed}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        {!collapsed && <StudyAchievements />}
      </div>

      {navigationItems.map(({ view: target, label, icon: Icon }) => (
        <button
          key={target}
          className={styles.primaryButton}
          type="button"
          aria-label={label}
          title={collapsed ? label : undefined}
          aria-pressed={
            view === target ||
            (target === "library" &&
              (view === "materials" || view === "reading"))
          }
          disabled={disabled}
          onClick={() => navigate(target)}
        >
          <Icon aria-hidden="true" />
          {!collapsed && <span>{label}</span>}
        </button>
      ))}

      <div className={styles.bottom}>
        {!collapsed && <StudyFootprint />}
        <div className={styles.settings}>
          <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
            <Popover.Trigger
              className={styles.primaryButton}
              aria-label="设置"
              title={collapsed ? "设置" : undefined}
              disabled={disabled}
            >
              <SettingsIcon aria-hidden="true" />
              {!collapsed && <span>设置</span>}
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
                <span>社区内容</span>
              </button>
              <button
                className={styles.settingsItem}
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenBackup();
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                <span>备份与恢复</span>
              </button>
              <Popover.Root
                open={settingsPanel === "display"}
                onOpenChange={(open) => {
                  setSettingsPanel("display", open);
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
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <div className={styles.settingLabel}>
                    <label htmlFor="reading-font-size">对话字号</label>
                    <output htmlFor="reading-font-size">
                      {settings.fontSize}px
                    </output>
                  </div>
                  <input
                    id="reading-font-size"
                    aria-label="对话字号"
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
                    <div
                      className={styles.appearanceOptions}
                      data-appearance={settings.appearance}
                    >
                      <button
                        className={styles.appearanceButton}
                        type="button"
                        aria-pressed={settings.appearance === "light"}
                        onClick={() =>
                          onSettingsChange({
                            ...settings,
                            appearance: "light",
                          })
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
                          onSettingsChange({
                            ...settings,
                            appearance: "dark",
                          })
                        }
                      >
                        <Moon aria-hidden="true" />
                        <span>夜间模式</span>
                      </button>
                    </div>
                  </fieldset>
                  <fieldset className={styles.appearance}>
                    <legend>色调</legend>
                    <div className={styles.toneOptions}>
                      {themes.map((theme) => (
                        <button
                          key={theme.id}
                          className={styles.toneLeaf}
                          type="button"
                          style={
                            {
                              "--tone-color":
                                theme.colors[settings.appearance].accent,
                              "--tone-background":
                                theme.colors[settings.appearance]
                                  .accentBackground,
                            } as CSSProperties
                          }
                          aria-pressed={
                            findTheme(settings.themeId).id === theme.id
                          }
                          onClick={() =>
                            onSettingsChange({
                              ...settings,
                              themeId: theme.id,
                            })
                          }
                        >
                          <span className={styles.toneMark} aria-hidden="true">
                            {findTheme(settings.themeId).id === theme.id ? (
                              <Check />
                            ) : (
                              <span className={styles.toneDot} />
                            )}
                          </span>
                          <span>{theme.name}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </PopoverPanel>
              </Popover.Root>
              <Popover.Root
                open={modelSettingsOpen}
                onOpenChange={(open) => {
                  setSettingsPanel("ai", open);
                  if (open) void ai.refresh();
                }}
              >
                <Popover.Trigger className={styles.settingsItem}>
                  <Cpu aria-hidden="true" />
                  <span>AI 配置</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <PopoverPanel
                    className={styles.popover}
                    title="AI 配置"
                    icon={Cpu}
                    titleId="ai-settings-heading"
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    width={340}
                    side="right"
                    align="end"
                    collisionPadding={12}
                    onInteractOutside={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest(
                          "[data-settings-select], [data-connection-delete-dialog]",
                        )
                      )
                        event.preventDefault();
                    }}
                  >
                    <AiSettings
                      key={ai.settings ? "ready" : "loading"}
                      settings={ai.settings}
                      serviceError={ai.error}
                      onRefresh={ai.refresh}
                      onSaved={ai.setSettings}
                    />
                  </PopoverPanel>
                </Popover.Portal>
              </Popover.Root>
            </PopoverPanel>
          </Popover.Root>
        </div>
      </div>
    </nav>
  );
}
