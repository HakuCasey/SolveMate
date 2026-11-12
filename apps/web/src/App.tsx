import { useEffect, useRef, useState } from "react";
import { NotebookPen, RefreshCw } from "lucide-react";
import { conversationMetadata } from "@solvemate/contracts";
import type {
  AppData,
  Conversation,
  CourseId,
  ReadingSelection,
  Robot,
} from "@solvemate/contracts";
import { sampleNotes, getCurrentContent } from "./data/catalog";
import { isRobotModified } from "./state/robots";
import {
  resolveConversationAi,
  resolveDefaults,
  defaultsForConversation,
  type RobotAiConfig,
} from "./ai/robot-config";
import { useAiService } from "./ai/useAiService";
import {
  useOfficialContent,
  type OfficialContent,
} from "./content/useOfficialContent";
import { updatedSelection } from "./content/selection";
import { ContentManager } from "./components/ContentManager";
import { useLocalData } from "./storage/useLocalData";
import {
  createConversation,
  replaceRobots,
  latestConversation,
  conversationForReading,
  updateConversation,
  deleteConversation,
  applyRobotAi,
} from "./state/conversations";
import { ConversationList } from "./components/ConversationList";
import { Sidebar } from "./components/Sidebar";
import { StudyOverview } from "./components/StudyOverview";
import { Reader } from "./components/Reader";
import { Markdown } from "./components/Markdown";
import { ChatPanel } from "./components/ChatPanel";
import { ResizableColumns } from "./components/ResizableColumns";
import {
  ConversationSwitchDialog,
  type ConversationSwitch,
} from "./components/ConversationSwitchDialog";
import { RobotsPage } from "./components/RobotsPage";
import { PwaControls } from "./components/PwaControls";
import { applyTheme } from "./theme/theme";
import styles from "./App.module.css";
import { clientRuntime } from "./version";
import { useSaveFeedback } from "./components/SaveFeedback";

type View = "reading" | "conversations" | "notes" | "robots" | "content";

export function App() {
  const content = useOfficialContent();
  if (!content.ready)
    return (
      <main className={styles.loading}>
        <h1>SolveMate</h1>
        <p role={content.loadError ? "alert" : "status"}>
          {content.loadError || "正在读取本地内容…"}
        </p>
        {content.loadError && (
          <button onClick={() => window.location.reload()}>重新打开</button>
        )}
      </main>
    );
  return <Workspace content={content} />;
}

function Workspace({ content }: { content: OfficialContent }) {
  const showSaved = useSaveFeedback();
  const courses = content.snapshot.activeCourses;
  const availableCourses = content.snapshot.allCourses;
  const {
    data,
    setData,
    loadFailed,
    saveState,
    conflict,
    retrySave,
    saveChanges,
  } = useLocalData(availableCourses);
  const [view, setView] = useState<View>("reading");
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeRobotId, setActiveRobotId] = useState<string | null>(null);
  const [aiSettingsSource, setAiSettingsSource] = useState<
    "chat" | "sidebar" | null
  >(null);
  const [robotDrafts, setRobotDrafts] = useState<Record<string, Robot>>({});
  const submitting = useRef(false);
  const [commandError, setCommandError] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<ConversationSwitch | null>(
    null,
  );
  const ai = useAiService((change) =>
    setData((previous) => (previous ? change(previous) : previous)),
  );
  const restoreAiConversation = ai.restore;
  const currentConversation = data
    ? view === "reading"
      ? conversationForReading(
          data.conversations,
          data.selection,
          activeConversationId,
        )
      : data.conversations.find(
          (item) =>
            item.status !== "deleted" && item.id === activeConversationId,
        )
    : undefined;
  const restoreConversationId = currentConversation?.id ?? null;
  const pendingAiIds =
    currentConversation?.turns
      ?.filter((turn) => turn.status === "running")
      .map((turn) => turn.id)
      .join(",") ?? "";
  useEffect(() => {
    if (restoreConversationId)
      void restoreAiConversation(
        restoreConversationId,
        pendingAiIds ? pendingAiIds.split(",") : [],
      );
  }, [restoreConversationId, pendingAiIds, restoreAiConversation]);
  const [noteId, setNoteId] = useState(sampleNotes[0].id);

  const appearance = data?.settings.appearance;
  useEffect(() => {
    if (appearance) applyTheme(appearance);
  }, [appearance]);

  function updateData(change: (previous: AppData) => AppData) {
    setData((previous) => (previous ? change(previous) : previous));
  }

  if (!data)
    return (
      <main className={styles.loading}>
        <h1>SolveMate</h1>
        {loadFailed ? (
          <>
            <p role="alert">
              无法读取本地学习记录。原有数据没有被清除，请检查浏览器存储权限后重试。
            </p>
            <button onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" />
              重新打开
            </button>
          </>
        ) : (
          <p role="status">正在读取本地内容…</p>
        )}
      </main>
    );

  const selection = data.selection;
  const currentRobotId =
    currentConversation?.robotId ?? activeRobotId ?? data.defaultRobotId;
  const currentRobot =
    data.robots.find((item) => item.id === currentRobotId) ??
    (currentConversation
      ? undefined
      : data.robots.find((item) => item.id === data.defaultRobotId));
  const chatDefaults = defaultsForConversation(
    currentConversation,
    currentRobot,
  );
  const note = sampleNotes.find((item) => item.id === noteId) ?? sampleNotes[0];
  const noteCourse = courses.find((item) => item.id === note.courseId);
  const noteQuestion = noteCourse?.questions.find(
    (item) => item.id === note.questionId,
  );
  // 阅读位置与会话关联分别保存，普通对话不能继承后台停留的题目。
  const chatSelection =
    view === "reading" ? selection : (currentConversation?.selection ?? null);
  const contextLabel = !chatSelection
    ? null
    : chatSelection.kind === "textbooks"
      ? "已关联当前章节"
      : `已关联 ${chatSelection.itemId}`;

  function selectContent(next: ReadingSelection) {
    const conversation = conversationForReading(data!.conversations, next);
    updateData((previous) => ({ ...previous, selection: next }));
    setActiveConversationId(conversation?.id ?? null);
    setActiveRobotId(conversation?.robotId ?? null);
    setView("reading");
  }

  function selectCourse(courseId: CourseId, kind: ReadingSelection["kind"]) {
    const course = courses.find((item) => item.id === courseId)!;
    if (selection.courseId === courseId && selection.kind === kind) {
      selectContent(selection);
      return;
    }
    const recent = latestConversation(
      data!.conversations.filter(
        (item) =>
          item.selection?.courseId === courseId &&
          item.selection.kind === kind &&
          (item.selection.version ?? "example-1") === course.version,
      ),
    );
    if (recent?.selection) {
      selectContent(recent.selection);
      return;
    }
    const itemId =
      kind === "textbooks" ? course.textbooks[0].id : course.questions[0].id;
    selectContent({
      courseId,
      version: course.version,
      kind,
      itemId,
      chapterIndex: 0,
    });
  }

  function openConversation(
    conversation: Conversation,
    returnToReading = false,
  ) {
    // 用原编号重新读取当前记录，页面切换不复制或重建原会话。
    const saved = data!.conversations.find(
      (item) => item.id === conversation.id,
    );
    if (
      !saved ||
      saved.status === "deleted" ||
      (returnToReading && saved.status !== "active")
    ) {
      setCommandError("此对话已删除或归档，请重新选择。");
      return;
    }
    conversation = saved;
    if (conversation.selection) {
      const readingSelection = conversation.selection;
      updateData((previous) => ({
        ...previous,
        selection: { ...readingSelection },
      }));
    }
    setActiveConversationId(conversation.id);
    setActiveRobotId(conversation.robotId);
    setView(
      returnToReading && conversation.selection ? "reading" : "conversations",
    );
  }

  async function newConversation(robot?: Robot) {
    const saved = await saveChanges((previous) => {
      const teacher =
        robot ??
        previous.robots.find((item) => item.id === previous.defaultRobotId);
      if (!teacher) return previous;
      const conversation = createConversation(
        previous,
        null,
        teacher.id,
        ai.settings,
      );
      return {
        ...previous,
        conversations: [conversation, ...previous.conversations],
      };
    });
    const conversation = saved.conversations[0];
    if (conversation) {
      setActiveConversationId(conversation.id);
      setActiveRobotId(conversation.robotId);
      setView("conversations");
    }
  }

  async function startFreshConversation(robot: Robot) {
    const saved = await saveChanges((previous) => {
      if (!previous.robots.some((item) => item.id === robot.id))
        throw new Error("所选教师已删除，请重新选择。");
      const conversation = createConversation(
        previous,
        chatSelection,
        robot.id,
        ai.settings,
        "teacher-switch",
        currentConversation?.id ?? null,
      );
      return {
        ...previous,
        conversations: [conversation, ...previous.conversations],
      };
    });
    setActiveConversationId(saved.conversations[0].id);
    setActiveRobotId(robot.id);
    setAiSettingsSource(null);
  }

  function changeRobot(id: string) {
    if (id === currentRobot?.id) return;
    const robot = data!.robots.find((item) => item.id === id);
    if (!robot) return;
    if (currentConversation) {
      setPendingSwitch({
        kind: "teacher",
        confirm: () => startFreshConversation(robot),
      });
    } else setActiveRobotId(id);
  }

  async function saveQuestion(text: string) {
    if (
      !currentRobot ||
      submitting.current ||
      currentConversation?.status === "archived" ||
      currentConversation?.turns.some((turn) => turn.status === "running")
    )
      return;
    const effective = resolveConversationAi(
      currentConversation,
      currentRobot,
      ai.settings,
    );
    if (effective.configured && effective.error)
      throw new Error(effective.error);
    submitting.current = true;
    try {
      const selected =
        currentConversation ??
        createConversation(data!, chatSelection, currentRobot.id, ai.settings);
      const turnId = crypto.randomUUID(),
        messageId = crypto.randomUUID(),
        createdAt = Date.now();
      const currentContent = chatSelection
        ? getCurrentContent(chatSelection, availableCourses)
        : null;
      const reference =
        chatSelection && currentContent
          ? {
              title: `${currentContent.topic} · ${currentContent.title}`,
              content: currentContent.content,
              selection: structuredClone(chatSelection),
            }
          : null;
      const saved = await saveChanges((previous) => {
        const existing =
          previous.conversations.find((item) => item.id === selected.id) ??
          selected;
        if (existing.status !== "active")
          throw new Error("此对话已归档或删除，请重新打开。");
        if (existing.turns.some((turn) => turn.status === "running"))
          throw new Error("此对话正在生成，请稍后提问。");
        const teacher = previous.robots.find(
          (item) => item.id === currentRobot.id,
        );
        if (!teacher) throw new Error("此教师已删除，请重新选择。");
        const resolved = resolveConversationAi(existing, teacher, ai.settings);
        if (
          resolved.error &&
          (resolved.configured ||
            existing.aiConfig.connectionId ||
            existing.aiConfig.modelId ||
            teacher.aiDefaults !== null)
        )
          throw new Error(resolved.error);
        const title =
          existing.titleSource === "default"
            ? text.slice(0, 24)
            : existing.title;
        const changed = {
          ...existing,
          revision: existing.revision + 1,
          title,
          titleSource:
            existing.titleSource === "default"
              ? ("first-message" as const)
              : existing.titleSource,
          aiConfig: {
            connectionId: resolved.connectionId || null,
            modelId: resolved.model || null,
          },
          messages: [
            ...existing.messages,
            {
              id: messageId,
              turnId,
              role: "user" as const,
              content: text,
              createdAt,
              ...(reference ? { reference } : {}),
            },
          ],
          turns: resolved.configured
            ? [
                ...existing.turns,
                {
                  id: turnId,
                  revision: 1,
                  connectionId: resolved.connectionId,
                  status: "running" as const,
                  submissionStatus: "pending" as const,
                  phase: "queued" as const,
                  startedAt: createdAt,
                  userMessageId: messageId,
                  snapshot: null,
                  dispatch: null,
                  reportedModelId: null,
                },
              ]
            : existing.turns,
          updatedAt: createdAt,
          lastActivityAt: createdAt,
        };
        return {
          ...previous,
          conversations: [
            changed,
            ...previous.conversations.filter((item) => item.id !== changed.id),
          ],
        };
      });
      const conversation = saved.conversations.find(
        (item) => item.id === selected.id,
      )!;
      const teacher = saved.robots.find((item) => item.id === currentRobot.id)!;
      const resolved = resolveConversationAi(
        conversation,
        teacher,
        ai.settings,
      );
      // 保存期间若用户已选中另一会话，后台提问不能覆盖其当前选择。
      setActiveConversationId((current) =>
        current === activeConversationId ? conversation.id : current,
      );
      if (resolved.configured)
        await ai.start({
          id: turnId,
          conversationId: conversation.id,
          connectionId: resolved.connectionId,
          ...(resolved.connectionRevision
            ? { connectionRevision: resolved.connectionRevision }
            : {}),
          ...(conversation.binding?.externalSessionId
            ? { externalSessionId: conversation.binding.externalSessionId }
            : {}),
          conversationSnapshot: conversationMetadata(conversation),
          robotRevision: teacher.revision,
          client: clientRuntime(),
          userMessageId: messageId,
          text,
          teacher: {
            id: teacher.id,
            name: teacher.name,
            prompt: teacher.prompt,
            icon: teacher.icon,
          },
          model: resolved.model,
          reference,
          history: selected.messages.slice(-24).map((item) => ({
            role: item.role,
            content: item.content.slice(-5000),
          })),
        });
    } finally {
      submitting.current = false;
    }
  }

  async function saveRobotAi(config: RobotAiConfig) {
    if (!currentRobot) return;
    const before = resolveConversationAi(
        currentConversation,
        currentRobot,
        ai.settings,
      ),
      after = resolveDefaults(config, ai.settings);
    if (after.error) throw new Error(after.error);
    const commit = async () => {
      const saved = await saveChanges((previous) => {
        const original = previous.conversations.find(
          (item) => item.id === currentConversation?.id,
        );
        if (original && original.revision !== currentConversation?.revision)
          throw new Error("当前对话已更新，请重新打开 AI 配置。");
        const next = applyRobotAi(
          previous,
          currentRobot.id,
          config,
          ai.settings,
          currentRobot.revision,
        );
        if (currentConversation && before.connectionId !== after.connectionId) {
          const fresh = createConversation(
            next,
            chatSelection,
            currentRobot.id,
            ai.settings,
            "service-switch",
            currentConversation.id,
          );
          return { ...next, conversations: [fresh, ...next.conversations] };
        }
        return next;
      });
      setRobotDrafts((previous) => {
        const next = { ...previous },
          draft = next[currentRobot.id],
          robot = saved.robots.find((item) => item.id === currentRobot.id)!;
        if (draft) {
          const updated = {
            ...draft,
            aiDefaults: structuredClone(config),
            revision: robot.revision,
          };
          if (isRobotModified(robot, updated)) next[currentRobot.id] = updated;
          else delete next[currentRobot.id];
        }
        return next;
      });
      if (currentConversation && before.connectionId !== after.connectionId)
        setActiveConversationId(saved.conversations[0].id);
      setAiSettingsSource(null);
      showSaved();
    };
    if (currentConversation && before.connectionId !== after.connectionId) {
      setAiSettingsSource(null);
      setPendingSwitch({ kind: "service", confirm: commit });
    } else await commit();
  }

  async function changeRobots(robots: Robot[], defaultId: string | null) {
    await saveChanges((previous) =>
      replaceRobots(previous, robots, defaultId, ai.settings),
    );
    if (activeRobotId && !robots.some((item) => item.id === activeRobotId))
      setActiveRobotId(null);
  }

  return (
    <main className={styles.app}>
      <ConversationSwitchDialog
        pending={pendingSwitch}
        onClose={() => setPendingSwitch(null)}
      />
      <div className={styles.shell}>
        <Sidebar
          subjects={courses}
          ai={ai}
          robot={currentRobot}
          robotAiConfig={chatDefaults}
          onRobotAiSave={saveRobotAi}
          aiSettingsSource={aiSettingsSource}
          onAiSettingsSourceChange={setAiSettingsSource}
          view={view}
          selection={selection}
          settings={data.settings}
          onNavigate={(next) => {
            if (next === "conversations") {
              const conversation =
                currentConversation ?? latestConversation(data.conversations);
              if (conversation) {
                openConversation(conversation);
                return;
              }
            }
            setView(next);
          }}
          onSelectContent={selectCourse}
          onSettingsChange={(settings) =>
            updateData((previous) => ({ ...previous, settings }))
          }
        />
        <section className={styles.workspace} aria-label="学习工作区">
          <StudyOverview />
          <ResizableColumns
            key={
              view === "reading" || view === "conversations"
                ? "split"
                : "static"
            }
            className={styles.columns}
            hidden={view === "robots" || view === "content"}
            enabled={view === "reading" || view === "conversations"}
            ratio={data.settings.readingPaneRatio ?? 0.5}
            onRatioChange={(readingPaneRatio) =>
              updateData((previous) => ({
                ...previous,
                settings: { ...previous.settings, readingPaneRatio },
              }))
            }
          >
            {view === "reading" && (
              <Reader
                key={`reader:${selection.courseId}:${selection.version}:${selection.kind}:${selection.itemId}:${selection.chapterIndex}`}
                availableCourses={availableCourses}
                historical={
                  courses.find((course) => course.id === selection.courseId)
                    ?.version !== selection.version
                }
                selection={selection}
                fontSize={data.settings.fontSize}
                onChange={selectContent}
              />
            )}
            {view === "conversations" && (
              <ConversationList
                availableCourses={availableCourses}
                conversations={data.conversations.filter(
                  (item) => item.status !== "deleted",
                )}
                robots={data.robots}
                activeId={currentConversation?.id ?? null}
                onOpen={openConversation}
                onReturn={(conversation) =>
                  openConversation(conversation, true)
                }
                onNew={() =>
                  void newConversation().catch((error) =>
                    setCommandError(String(error)),
                  )
                }
                onUpdate={async (id, change, revision) => {
                  await saveChanges((previous) =>
                    updateConversation(previous, id, change, revision),
                  );
                }}
                onDelete={async (id) => {
                  for (const turn of Object.values(ai.turns))
                    if (turn.conversationId === id && turn.status === "running")
                      await ai.cancel(turn.id);
                  await saveChanges((previous) =>
                    deleteConversation(previous, id),
                  );
                  if (activeConversationId === id)
                    setActiveConversationId(null);
                }}
              />
            )}
            {view === "notes" && (
              <>
                <section className={styles.library} aria-label="笔记列表">
                  <header className={styles.libraryHeading}>
                    <div>
                      <h2>笔记</h2>
                      <span>{sampleNotes.length} 篇示例笔记</span>
                    </div>
                    <NotebookPen aria-hidden="true" />
                  </header>
                  <div className={styles.libraryList}>
                    {sampleNotes.map((item) => (
                      <button
                        key={item.id}
                        className={styles.libraryItem}
                        aria-label={item.title}
                        aria-pressed={note.id === item.id}
                        onClick={() => setNoteId(item.id)}
                      >
                        <span className={styles.libraryIcon}>
                          <NotebookPen aria-hidden="true" />
                        </span>
                        <span className={styles.libraryCopy}>
                          <strong>{item.title}</strong>
                          <small>
                            {
                              courses.find(
                                (course) => course.id === item.courseId,
                              )?.title
                            }{" "}
                            · {item.questionId}
                          </small>
                          <span>{item.summary}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
                <section
                  className={styles.note}
                  aria-label="笔记阅读区"
                  key={note.id}
                >
                  <article
                    className={styles.notePaper}
                    aria-label="笔记正文"
                    style={{ fontSize: data.settings.fontSize }}
                  >
                    <header className={styles.noteHeading}>
                      <h1>{note.title}</h1>
                      <p className={styles.noteSource}>
                        <span>{noteCourse?.title ?? "课程不可用"}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          关联题目：{noteQuestion?.title ?? note.questionId}
                        </span>
                      </p>
                    </header>
                    <div className={styles.noteBody}>
                      <Markdown>{note.content}</Markdown>
                    </div>
                  </article>
                </section>
              </>
            )}
            {(view === "reading" || view === "conversations") && (
              <ChatPanel
                key={`chat:${
                  currentConversation?.id ??
                  (chatSelection
                    ? `${chatSelection.courseId}:${chatSelection.version}:${chatSelection.kind}:${chatSelection.itemId}:${chatSelection.chapterIndex}`
                    : "ordinary-chat")
                }`}
                robots={data.robots}
                robotId={currentRobot?.id ?? null}
                conversation={currentConversation}
                contextLabel={contextLabel}
                textbook={chatSelection?.kind === "textbooks"}
                onRobotChange={changeRobot}
                onSend={saveQuestion}
                ai={ai}
                aiSettingsOpen={aiSettingsSource === "chat"}
                onConfigure={() =>
                  setAiSettingsSource((source) =>
                    source === "chat" ? null : "chat",
                  )
                }
              />
            )}
          </ResizableColumns>
          {view === "content" && (
            <ContentManager
              content={content}
              onInstall={content.install}
              onRead={(id) => {
                const course = courses.find((course) => course.id === id)!;
                if (selection.courseId === id)
                  selectContent(
                    updatedSelection(selection, course, availableCourses),
                  );
                else selectCourse(id, "questions");
              }}
            />
          )}
          <div className={styles.robots} hidden={view !== "robots"}>
            <RobotsPage
              robots={data.robots}
              defaultRobotId={data.defaultRobotId}
              activeRobotId={currentRobot?.id ?? null}
              onChange={changeRobots}
              onUse={newConversation}
              aiSettings={ai.settings}
              drafts={robotDrafts}
              onDraftsChange={setRobotDrafts}
            />
          </div>
        </section>
      </div>
      <footer className={styles.footer}>
        {commandError && <span role="alert">{commandError}</span>}
        <span role={saveState === "error" ? "alert" : "status"}>
          {conflict
            ? "另一窗口已更新记录，本页更改尚未保存，请重新读取"
            : saveState === "saving"
              ? "正在保存到本地…"
              : saveState === "error"
                ? "本次更改尚未保存，请重试"
                : "已保存在当前浏览器"}
        </span>
        {saveState === "error" && (
          <button
            onClick={conflict ? () => window.location.reload() : retrySave}
          >
            {conflict ? "重新读取" : "重试保存"}
          </button>
        )}
        <PwaControls saved={saveState === "saved"} />
      </footer>
    </main>
  );
}
