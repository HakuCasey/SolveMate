import {
  AccountSettingsDialog,
  type ProfileSettings,
} from "./AccountSettingsDialog";
import { PetPanel } from "./PetPanel";
import badgeStyles from "./StudyOverview.module.css";
import { useSidebarLayout } from "./SidebarLayout";
import { PopoverPanel } from "./PopoverPanel";
import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Popover } from "radix-ui";
import {
  ArchiveRestore,
  BookOpen,
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
  UserRoundCog,
  PawPrint,
  School,
  MessageSquarePlus,
  SlidersHorizontal,
  Sun,
  UserRoundPlus,
} from "lucide-react";
import type { Settings } from "@solvemate/contracts";
import type { AiService } from "../ai/useAiService";
import { AiSettings } from "./AiSettings";
import { ContentServiceSettings } from "./ContentServiceSettings";
import { StudyFootprint, StudyAchievements } from "./StudyOverview";
import wordmark from "../assets/solvemate-wordmark.png";
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
  children: ReactNode;
  needsAttention: boolean;
  onOpenBackup: () => void;
  view: View;
  settings: Settings;
  onNavigate: (view: View) => void;
  onSaveProfile: (
    changes: ProfileSettings & Pick<Settings, "petName">,
  ) => Promise<unknown>;
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

const projectUrl = "https://github.com/HakuCasey/SolveMate";
const defaultAvatar = "/logo.png";

const sidebarMenuLayout = {
  width: 200,
  maxWidth: 200,
  padding: 8,
  side: "right",
  sideOffset: 12,
  collisionPadding: 12,
} as const;

function AccountMenu({
  profile,
  disabled,
  onSave,
  onOpenPet,
}: {
  onOpenPet: () => void;
  profile: ProfileSettings;
  disabled: boolean;
  onSave: (changes: ProfileSettings) => Promise<unknown>;
}) {
  const [panel, setPanel] = useState<"closed" | "menu" | "settings">("closed");
  const avatar = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Popover.Root
        open={panel === "menu"}
        onOpenChange={(next) =>
          setPanel((current) =>
            next ? "menu" : current === "menu" ? "closed" : current,
          )
        }
      >
        <Popover.Trigger
          ref={avatar}
          className={styles.avatarButton}
          aria-label="用户菜单"
          disabled={disabled}
        >
          <img
            className={styles.avatarImage}
            src={profile.profileAvatar ?? defaultAvatar}
            alt=""
          />
        </Popover.Trigger>
        <PopoverPanel
          {...sidebarMenuLayout}
          className={styles.popover}
          align="start"
          onCloseAutoFocus={(event) => {
            if (panel === "settings") event.preventDefault();
          }}
          aria-label="用户账户"
        >
          <button
            type="button"
            className={styles.settingsItem}
            onClick={() => setPanel("settings")}
          >
            <UserRoundCog aria-hidden="true" />
            账号设置
          </button>
          <hr className={styles.accountDivider} />
          <button
            className={styles.settingsItem}
            onClick={() => {
              setPanel("closed");
              onOpenPet();
            }}
          >
            <PawPrint aria-hidden="true" />
            虚拟宠物
          </button>
          <button className={styles.settingsItem} disabled>
            <UserRoundPlus aria-hidden="true" />
            邀请好友
          </button>
          <hr className={styles.accountDivider} />
          <button className={styles.settingsItem} disabled>
            <LogOut aria-hidden="true" />
            退出登录
          </button>
        </PopoverPanel>
      </Popover.Root>
      {panel === "settings" && (
        <AccountSettingsDialog
          profile={profile}
          defaultAvatar={defaultAvatar}
          onSave={onSave}
          onClose={() => setPanel("closed")}
          onReturnFocus={() => avatar.current?.focus()}
        />
      )}
    </>
  );
}

export function Sidebar({
  children,
  needsAttention,
  onOpenBackup,
  view,
  settings,
  onNavigate,
  onSaveProfile,
  onSettingsChange,
  disabled = false,
  ai,
}: SidebarProps) {
  const { collapsed } = useSidebarLayout();
  const [petOpen, setPetOpen] = useState(false);
  const petName = settings.petName === undefined ? "小黑" : settings.petName;
  const [settingsMenu, setSettingsMenu] = useState<
    "closed" | "menu" | "display" | "ai" | "content" | "help"
  >("closed");
  const settingsOpen = settingsMenu !== "closed";
  const settingsPanel =
    settingsMenu === "closed" || settingsMenu === "menu" ? null : settingsMenu;
  const modelSettingsOpen = settingsPanel === "ai";

  function setSettingsOpen(open: boolean) {
    setSettingsMenu(open ? "menu" : "closed");
  }

  // 菜单与子气泡共用一个状态；迟到的关闭事件不能关闭另一个气泡或重开菜单。
  function setSettingsPanel(
    panel: "display" | "ai" | "content" | "help",
    open: boolean,
  ) {
    setSettingsMenu((current) => {
      if (current === "closed") return current;
      return open ? panel : current === panel ? "menu" : current;
    });
  }

  function navigate(nextView: View) {
    setSettingsOpen(false);
    onNavigate(nextView);
  }

  return (
    <nav
      id="main-sidebar"
      className={styles.sidebar}
      data-collapsed={collapsed}
      aria-label="功能菜单"
    >
      <Popover.Root open={petOpen} onOpenChange={setPetOpen}>
        <Popover.Anchor asChild>
          <div className={styles.profile}>
            <AccountMenu
              profile={settings}
              disabled={disabled}
              onSave={onSaveProfile}
              onOpenPet={() => setPetOpen(true)}
            />
            {!collapsed && (
              <div className={styles.profileBadges}>
                <StudyAchievements />
                <Popover.Trigger
                  type="button"
                  disabled={disabled}
                  aria-label="虚拟宠物"
                  className={`${badgeStyles.badge} ${badgeStyles.entry}`}
                  data-earned={petName !== null}
                >
                  <PawPrint
                    className={badgeStyles.badgeIcon}
                    aria-hidden="true"
                  />
                </Popover.Trigger>
              </div>
            )}
          </div>
        </Popover.Anchor>
        {petOpen && (
          <Popover.Portal>
            <PetPanel
              name={petName}
              onRename={(petName) => onSaveProfile({ petName })}
            />
          </Popover.Portal>
        )}
      </Popover.Root>

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
              className={`${styles.primaryButton} ${styles.settingsTrigger}`}
              data-attention={needsAttention || undefined}
              aria-label="系统设置"
              aria-description={
                needsAttention ? "备份与恢复中有待处理的操作" : undefined
              }
              title={needsAttention ? "系统设置 · 有操作需要处理" : "系统设置"}
              disabled={disabled}
            >
              <svg
                className={styles.settingsLogo}
                viewBox={collapsed ? "40 35 410 320" : "0 0 1564 392"}
                aria-hidden="true"
              >
                <image href={wordmark} width="1564" height="392" />
              </svg>
            </Popover.Trigger>
            <PopoverPanel
              {...sidebarMenuLayout}
              className={styles.popover}
              align="end"
              aria-label="系统设置选项"
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
                  className={styles.popover}
                  title="显示设置"
                  icon={SlidersHorizontal}
                  titleId="display-settings-heading"
                  width={220}
                  maxWidth={220}
                  side="right"
                  align="end"
                  sideOffset={12}
                  collisionPadding={12}
                  aria-labelledby="display-settings-heading"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
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
                open={settingsPanel === "content"}
                onOpenChange={(open) => setSettingsPanel("content", open)}
              >
                <Popover.Trigger className={styles.settingsItem}>
                  <Download aria-hidden="true" />
                  <span>社区内容</span>
                </Popover.Trigger>
                <PopoverPanel
                  className={styles.popover}
                  width={324}
                  side="right"
                  align="end"
                  sideOffset={12}
                  collisionPadding={12}
                  aria-label="社区内容设置"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <ContentServiceSettings
                    settings={settings}
                    onSave={onSettingsChange}
                    onOpenContent={() => navigate("content")}
                  />
                </PopoverPanel>
              </Popover.Root>
              <button
                className={styles.settingsItem}
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenBackup();
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                <span>备份与恢复</span>
                {needsAttention && (
                  <span
                    className={styles.issueDot}
                    role="img"
                    aria-label="有操作需要处理"
                  />
                )}
              </button>
              <Popover.Root
                open={settingsPanel === "help"}
                onOpenChange={(open) => setSettingsPanel("help", open)}
              >
                <Popover.Trigger className={styles.settingsItem}>
                  <CircleHelp aria-hidden="true" />
                  <span>帮助与反馈</span>
                </Popover.Trigger>
                <PopoverPanel
                  title="帮助与反馈"
                  icon={CircleHelp}
                  {...sidebarMenuLayout}
                  align="end"
                >
                  <a
                    className={styles.settingsItem}
                    href={`${projectUrl}/blob/HEAD/docs/product/manual/README.md`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <BookOpen aria-hidden="true" />
                    使用指南
                  </a>
                  <a
                    className={styles.settingsItem}
                    href={`${projectUrl}/issues/new`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <MessageSquarePlus aria-hidden="true" />
                    <span>意见反馈</span>
                  </a>
                </PopoverPanel>
              </Popover.Root>
            </PopoverPanel>
          </Popover.Root>
        </div>
        {children}
      </div>
    </nav>
  );
}
