import { useEffect, useState } from "react";
import { NotebookPen, RefreshCw } from "lucide-react";
import type {
  AppData,
  Conversation,
  CourseId,
  ReadingSelection,
  Robot,
} from "@solvemate/contracts";
import { sampleNotes } from "./data/catalog";
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
  sameContent,
  updateConversation,
  deleteConversation,
} from "./state/conversations";
import { ConversationList } from "./components/ConversationList";
import { Sidebar } from "./components/Sidebar";
import { StudyOverview } from "./components/StudyOverview";
import { Reader } from "./components/Reader";
import { Markdown } from "./components/Markdown";
import { ChatPanel } from "./components/ChatPanel";
import { RobotsPage } from "./components/RobotsPage";
import { PwaControls } from "./components/PwaControls";
import styles from "./App.module.css";

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
  const courses = content.snapshot.activeCourses;
  const availableCourses = content.snapshot.allCourses;
  const { data, setData, loadFailed, saveState, conflict, retrySave } =
    useLocalData(availableCourses);
  const [view, setView] = useState<View>("reading");
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [activeRobotId, setActiveRobotId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState(sampleNotes[0].id);

  useEffect(() => {
    if (data)
      document.documentElement.style.colorScheme = data.settings.appearance;
  }, [data]);

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
  const currentConversation = data.conversations.find(
    (item) =>
      item.deletedAt === undefined &&
      item.id === activeConversationId &&
      (view !== "reading" || sameContent(item.selection, selection)),
  );
  const currentRobotId =
    currentConversation?.robotId ?? activeRobotId ?? data.defaultRobotId;
  const currentRobot =
    data.robots.find((item) => item.id === currentRobotId) ??
    data.robots.find((item) => item.id === data.defaultRobotId);
  const note = sampleNotes.find((item) => item.id === noteId) ?? sampleNotes[0];
  // 阅读位置与会话关联分别保存，普通对话不能继承后台停留的题目。
  const chatSelection =
    view === "reading" ? selection : (currentConversation?.selection ?? null);
  const contextLabel = !chatSelection
    ? null
    : chatSelection.kind === "textbooks"
      ? "已关联当前章节"
      : `已关联 ${chatSelection.itemId}`;

  function selectContent(next: ReadingSelection) {
    updateData((previous) => ({ ...previous, selection: next }));
    setActiveConversationId(null);
    setView("reading");
  }

  function selectCourse(courseId: CourseId, kind: ReadingSelection["kind"]) {
    const course = courses.find((item) => item.id === courseId)!;
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

  function openConversation(conversation: Conversation) {
    if (conversation.selection) {
      const readingSelection = conversation.selection;
      updateData((previous) => ({
        ...previous,
        selection: { ...readingSelection },
      }));
    }
    setActiveConversationId(conversation.id);
    setActiveRobotId(conversation.robotId);
    setView("conversations");
  }

  function newConversation(robot?: Robot) {
    const nextData = robot
      ? {
          ...data!,
          robots: data!.robots.map((item) =>
            item.id === robot.id ? robot : item,
          ),
        }
      : data!;
    if (!nextData.robots.length) return;
    const conversation = createConversation(
      nextData,
      null,
      robot?.id ?? nextData.defaultRobotId,
    );
    updateData((previous) => ({
      ...previous,
      robots: robot
        ? previous.robots.map((item) => (item.id === robot.id ? robot : item))
        : previous.robots,
      conversations: [conversation, ...previous.conversations],
    }));
    setActiveConversationId(conversation.id);
    setActiveRobotId(conversation.robotId);
    setView("conversations");
  }

  function changeRobot(id: string) {
    setActiveRobotId(id);
    if (!currentConversation) return;
    updateData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((item) =>
        item.id === currentConversation.id ? { ...item, robotId: id } : item,
      ),
    }));
  }

  function saveQuestion(text: string) {
    if (!currentRobot) return;
    const conversation =
      currentConversation ??
      createConversation(data!, chatSelection, currentRobot.id);
    const message = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: text,
      createdAt: Date.now(),
    };
    updateData((previous) => {
      const existing =
        previous.conversations.find((item) => item.id === conversation.id) ??
        conversation;
      const changed = {
        ...existing,
        title: existing.title === "新对话" ? text.slice(0, 24) : existing.title,
        messages: [...existing.messages, message],
        updatedAt: Date.now(),
      };
      return {
        ...previous,
        conversations: [
          changed,
          ...previous.conversations.filter((item) => item.id !== changed.id),
        ],
      };
    });
    setActiveConversationId(conversation.id);
  }

  function changeRobots(robots: Robot[], defaultId: string | null) {
    updateData((previous) => replaceRobots(previous, robots, defaultId));
    if (activeRobotId && !robots.some((item) => item.id === activeRobotId))
      setActiveRobotId(null);
  }

  return (
    <main className={styles.app}>
      <div className={styles.shell}>
        <Sidebar
          subjects={courses}
          view={view}
          selection={selection}
          settings={data.settings}
          onNavigate={(next) => {
            if (
              next === "conversations" &&
              !currentConversation &&
              data.conversations.some(
                (item) => item.deletedAt === undefined && !item.archived,
              )
            )
              openConversation(
                data.conversations.find(
                  (item) => item.deletedAt === undefined && !item.archived,
                )!,
              );
            else setView(next);
          }}
          onSelectContent={selectCourse}
          onSettingsChange={(settings) =>
            updateData((previous) => ({ ...previous, settings }))
          }
        />
        <section className={styles.workspace} aria-label="学习工作区">
          <StudyOverview />
          <div
            className={styles.columns}
            hidden={view === "robots" || view === "content"}
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
                  (item) => item.deletedAt === undefined,
                )}
                robots={data.robots}
                activeId={currentConversation?.id ?? null}
                onOpen={openConversation}
                onNew={() => newConversation()}
                onUpdate={(id, change) =>
                  updateData((previous) =>
                    updateConversation(previous, id, change),
                  )
                }
                onDelete={(id) => {
                  updateData((previous) => deleteConversation(previous, id));
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
                <article className={styles.note} aria-label="笔记正文">
                  <header>
                    {courses.find((item) => item.id === note.courseId)?.title} ·
                    关联题目 {note.questionId}
                  </header>
                  <div
                    className={styles.noteBody}
                    style={{ fontSize: data.settings.fontSize }}
                  >
                    <h1>{note.title}</h1>
                    <Markdown>{note.content}</Markdown>
                  </div>
                </article>
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
              />
            )}
          </div>
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
            />
          </div>
        </section>
      </div>
      <footer className={styles.footer}>
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
