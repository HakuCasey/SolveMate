import { activeSessionBinding, serviceSwitchKind } from "./ai/session-bindings";
import { recordQuestion } from "./state/questions";
import { materialApi } from "./materials/api";
import { dataRefresh } from "./refresh/coordinator";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { OfficialLibrary } from "./content/library";
import { OfficialLibraryService } from "./content/library-service";
import { officialEntryId } from "./content/entries";
import { Link, NotebookPen, RefreshCw, SquarePen } from "lucide-react";
import { conversationMetadata } from "@solvemate/contracts";
import type {
  AppData,
  Subject,
  Conversation,
  CourseId,
  ReadingSelection,
  Robot,
  MaterialLocation,
  ReadingReference,
  SessionBinding,
  LearningLocation,
  Note,
} from "@solvemate/contracts";
import { applyNoteAction, noteTags, createNote, editNote } from "./state/notes";
import {
  LearningRelations,
  LearningMaterial,
  sourceForNote,
} from "./reading/relations";
import { RelatedLearning } from "./components/RelatedLearning";
import {
  NoteEditorDialog,
  type NoteEditorTarget,
} from "./components/NoteEditorDialog";
import { isRobotModified } from "./state/robots";
import {
  resolveConversationAi,
  resolveDefaults,
  defaultsForConversation,
  type RobotAiConfig,
} from "./ai/robot-config";
import { useAiService } from "./ai/useAiService";
import { localAi } from "./ai/local-api";
import {
  useOfficialContent,
  type OfficialContent,
} from "./content/useOfficialContent";
import { ContentManager } from "./components/ContentManager";
import { useLocalData } from "./storage/useLocalData";
import {
  createConversation,
  replaceRobots,
  latestConversation,
  conversationForReading,
  conversationForMaterial,
  updateConversation,
  deleteConversation,
  applyRobotAi,
} from "./state/conversations";
import { NotebookList } from "./components/NotebookList";
import { PaneHeader } from "./components/PaneHeader";
import { ConversationList } from "./components/ConversationList";
import { Sidebar } from "./components/Sidebar";
import { SubjectDialog, type SubjectAction } from "./components/SubjectDialog";
import {
  addSubject,
  renameSubject,
  createSubjectDirectory,
} from "./state/subjects";
import { SubjectContentList } from "./components/SubjectContentList";
import { scopeForMaterial, type LibraryScope } from "./reading/library";
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
import { useMaterials } from "./materials/useMaterials";
const MaterialReader = lazy(() =>
  import("./materials/MaterialReader").then((module) => ({
    default: module.MaterialReader,
  })),
);
import { locationKey } from "./materials/api";
import {
  appendReference,
  readingKey,
  validateReferenceCount,
  messageReferences,
  isSupportedReadingReference,
  isSupportedReadingLocation,
  UNSUPPORTED_READING_REFERENCE,
} from "./reading/reference";
import { useReadingState } from "./reading/useReadingState";
import {
  emptyReadingPosition,
  readingDocumentKey,
  restoreReadingLocation,
  readingLocationForConversation,
  type ReadingPositionState,
  type ReadingScroll,
} from "./reading/state";
import type { SetStateAction } from "react";
import { applyTheme } from "./theme/theme";
import { teachingActivities, type TeachingActivityId } from "./data/teaching";
import styles from "./App.module.css";
import { clientRuntime } from "./version";
import {
  loadReloadCheckpoint,
  saveReloadCheckpoint,
  clearReloadCheckpoint,
} from "./pwa/reload-checkpoint";
import { RefreshControls } from "./refresh/RefreshControls";
import { useDraftBackup, formDrafts } from "./refresh/drafts";
import { useSaveFeedback } from "./components/SaveFeedback";
import {
  UserStorageGate,
  useUserStorageStatus,
} from "./storage/UserStorageGate";

type View =
  | "reading"
  | "conversations"
  | "notes"
  | "teaching"
  | "robots"
  | "content"
  | "materials"
  | "library";

export function App() {
  return (
    <UserStorageGate>
      <LocalWorkspace />
    </UserStorageGate>
  );
}

function LocalWorkspace() {
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
  const storageStatus = useUserStorageStatus();
  const showSaved = useSaveFeedback();
  const [reloadCheckpoint] = useState(loadReloadCheckpoint);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>(
    reloadCheckpoint.value?.drafts ?? {},
  );
  const {
    state: readingState,
    updatePosition,
    updateDocument,
    updateReferences,
    rememberLocation,
    restoreProgress,
  } = useReadingState(reloadCheckpoint.value?.reading);
  const { readSnapshot, reloadLocal, install } = content;
  const sourceCourses = content.snapshot.activeCourses;
  const sourceAvailableCourses = content.snapshot.allCourses;
  const {
    data,
    setData,
    loadFailed,
    saveState,
    conflict,
    retrySave,
    saveChanges,
    readData,
    readSaveState,
    refreshError,
    saveError,
    conflicts,
    recoveries,
    resolveConflict,
  } = useLocalData(sourceAvailableCourses);
  const checkpointRestored = useRef(false);
  const officialSaveState = useRef(readSaveState);
  officialSaveState.current = readSaveState;
  const officialCatalog = useRef({
    remote: content.remote,
    updates: content.updates,
  });
  officialCatalog.current = {
    remote: content.remote,
    updates: content.updates,
  };
  const readOfficialLibrary = useCallback(
    () =>
      new OfficialLibrary(
        readSnapshot(),
        readData() ?? {},
        officialCatalog.current.remote,
        officialCatalog.current.updates,
      ),
    [readSnapshot, readData],
  );
  const officialService = useMemo(
    () =>
      new OfficialLibraryService({
        read: readOfficialLibrary,
        refresh: async () => {
          if (!(await dataRefresh.refresh(["records", "content"], true)))
            throw new Error("未能读取最新资料状态，请确认本机服务可用后重试。");
          if (officialSaveState.current() === "error")
            throw new Error("本机记录存在未保存修改，请先处理保存状态。");
        },
        load: reloadLocal,
        install,
        save: saveChanges,
      }),
    [readOfficialLibrary, reloadLocal, install, saveChanges],
  );
  const officialOperation = useSyncExternalStore(
    officialService.subscribe,
    officialService.snapshot,
    officialService.snapshot,
  );
  const officialLibrary = useMemo(
    () =>
      new OfficialLibrary(
        content.snapshot,
        {
          subjects: data?.subjects,
          officialMaterials: data?.officialMaterials,
        },
        content.remote,
        content.updates,
      ),
    [
      content.snapshot,
      data?.subjects,
      data?.officialMaterials,
      content.remote,
      content.updates,
    ],
  );
  const progressRestored = useRef(false);
  useEffect(() => {
    if (!data || progressRestored.current) return;
    progressRestored.current = true;
    if (data.readingProgress) restoreProgress(data.readingProgress);
    setChatDrafts((current) => ({ ...data.drafts, ...current }));
  }, [data, restoreProgress]);
  const previousDrafts = useRef<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    const old = previousDrafts.current;
    previousDrafts.current = data.drafts;
    if (!old) return;
    setChatDrafts((current) => {
      const next = { ...current, ...data.drafts };
      for (const key of Object.keys(old))
        if (!(key in (data.drafts ?? {}))) delete next[key];
      return next;
    });
  }, [data?.drafts, data]);
  const hasData = !!data;
  useEffect(() => {
    if (!hasData || !progressRestored.current) return;
    // 滚动位置合并保存，避免每个滚动事件都写一次数据库。
    const timer = window.setTimeout(() => {
      setData((current) => {
        if (!current) return current;
        const progress = {
          positions: readingState.positions,
          documents: readingState.documents,
        };
        if (
          (!Object.keys(progress.positions).length &&
            !Object.keys(progress.documents).length &&
            !current.readingProgress) ||
          JSON.stringify(current.readingProgress) === JSON.stringify(progress)
        )
          return current;
        return { ...current, readingProgress: progress };
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hasData, readingState.positions, readingState.documents, setData]);
  useEffect(() => {
    if (data && reloadCheckpoint.value && !checkpointRestored.current) {
      clearReloadCheckpoint();
      checkpointRestored.current = true;
    }
  }, [data, reloadCheckpoint]);
  const subjectDirectory = officialLibrary.directory;
  const subjects = subjectDirectory.active;
  const availableCourses = useMemo(
    () =>
      sourceAvailableCourses.map((item) => ({
        ...item,
        title: subjectDirectory.byId.get(item.id)?.title ?? item.title,
      })),
    [sourceAvailableCourses, subjectDirectory],
  );
  const readSubjects = useCallback(() => {
    const current = readData();
    if (!current) throw new Error("学科目录尚未读取完成，请稍后重试。");
    return createSubjectDirectory(sourceCourses, current.subjects);
  }, [sourceCourses, readData]);
  const materials = useMaterials(readSubjects);
  const relationConversations = data?.conversations;
  const relationNotes = data?.noteLibrary;
  const relations = useMemo(
    () =>
      new LearningRelations(
        {
          conversations: relationConversations ?? [],
          noteLibrary: relationNotes,
        },
        sourceAvailableCourses,
        materials.items,
        officialLibrary,
      ),
    [
      relationConversations,
      relationNotes,
      sourceAvailableCourses,
      materials.items,
      officialLibrary,
    ],
  );
  const [noteEditor, setNoteEditor] = useState<NoteEditorTarget | null>(null);
  const [subjectAction, setSubjectAction] = useState<SubjectAction | null>(
    null,
  );
  const [view, setView] = useState<View>("conversations");
  const [teachingActivity, setTeachingActivity] = useState<TeachingActivityId>(
    teachingActivities[0].id,
  );
  const selectedTeachingActivity = teachingActivities.find(
    (activity) => activity.id === teachingActivity,
  )!;
  const [libraryScope, setLibraryScope] = useState<LibraryScope>({
    courseId: "calculus",
    kind: "textbooks",
  });
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(reloadCheckpoint.value?.conversationId ?? null);
  const [activeRobotId, setActiveRobotId] = useState<string | null>(null);
  const [aiSettingsSource, setAiSettingsSource] = useState<
    "chat" | "sidebar" | null
  >(null);
  const [robotDrafts, setRobotDrafts] = useState<Record<string, Robot>>({});
  useDraftBackup(
    "robot-configurations",
    "机器人配置草稿",
    robotDrafts,
    Object.keys(robotDrafts).length > 0,
  );
  const submitting = useRef(false);
  const [commandError, setCommandError] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<ConversationSwitch | null>(
    null,
  );
  const ai = useAiService((change) =>
    setData((previous) => (previous ? change(previous) : previous)),
  );
  const refreshAiSettings = ai.refresh;
  useEffect(() => {
    // 页面和对话切换、打开配置时读取共享记录，不逐个通知使用配置的组件。
    void refreshAiSettings();
  }, [view, activeConversationId, aiSettingsSource, refreshAiSettings]);
  const restoreAiConversation = ai.restore;
  const quoteKey =
    view === "materials" && data?.materialSelection
      ? locationKey(data.materialSelection)
      : view === "reading" && data?.selection
        ? readingKey(data.selection)
        : "";
  const documentKey =
    view === "materials" && data?.materialSelection
      ? readingDocumentKey(data.materialSelection)
      : view === "reading" && data?.selection
        ? readingDocumentKey(data.selection)
        : "";
  const readingPosition =
    readingState.positions[quoteKey] ?? emptyReadingPosition();
  // 同一资料的多个页码共用待发送引用；题目按自身位置保存。
  const referenceDraftKey =
    view === "materials" ||
    (view === "reading" && data?.selection.kind === "textbooks")
      ? documentKey
      : quoteKey;
  const draftReferences = readingState.references[referenceDraftKey] ?? [];
  function addReference(reference: ReadingReference) {
    const references = appendReference(
      draftReferences,
      reference,
      crypto.randomUUID(),
    );
    updateReferences(referenceDraftKey, references);
  }
  const setReadingPosition = useCallback(
    (change: SetStateAction<ReadingPositionState>) =>
      updatePosition(quoteKey, change),
    [quoteKey, updatePosition],
  );
  const setReadingZoom = useCallback(
    (zoom: number) =>
      updateDocument(documentKey, (previous) => ({ ...previous, zoom })),
    [documentKey, updateDocument],
  );
  const setReadingContinuous = useCallback(
    (continuous: boolean) =>
      updateDocument(documentKey, (previous) => ({ ...previous, continuous })),
    [documentKey, updateDocument],
  );
  const savePdfScroll = useCallback(
    (location: LearningLocation, scroll: ReadingScroll) => {
      const key =
        "materialId" in location ? locationKey(location) : readingKey(location);
      updatePosition(key, (previous) =>
        previous.scroll.top === scroll.top &&
        previous.scroll.left === scroll.left
          ? previous
          : { ...previous, scroll },
      );
    },
    [updatePosition],
  );
  useEffect(() => {
    const location =
      view === "materials"
        ? data?.materialSelection
        : view === "reading"
          ? data?.selection
          : null;
    if (location) rememberLocation(location);
  }, [view, data?.materialSelection, data?.selection, rememberLocation]);

  const currentConversation = data
    ? view === "library"
      ? undefined
      : view === "materials"
        ? data.materialSelection
          ? conversationForMaterial(
              data.conversations,
              data.materialSelection,
              activeConversationId,
            )
          : undefined
        : view === "reading"
          ? conversationForReading(
              data.conversations,
              data.selection,
              activeConversationId,
            )
          : (data.conversations.find(
              (item) =>
                item.status !== "deleted" && item.id === activeConversationId,
            ) ??
            (view === "conversations" && activeConversationId === null
              ? latestConversation(data.conversations)
              : undefined))
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
  const [noteId, setNoteId] = useState<string | null>(null);
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(true);

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
              无法读取本机学习记录。原有数据已保留，请确认本机服务已启动后重试。
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
  const resizable =
    view === "reading" ||
    view === "conversations" ||
    view === "notes" ||
    view === "materials" ||
    view === "library";
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
  const noteLibrary = data.noteLibrary!;
  const note =
    noteLibrary.notes.find((item) => item.id === noteId) ??
    noteLibrary.notes[0];
  const noteDisplayTagIds =
    note?.tagIds.filter((id) => !id.startsWith("subject:")) ?? [];
  const noteSource = note ? sourceForNote(note) : null;
  const noteMaterial = noteSource ? relations.material(noteSource) : null;
  const noteNotebook = noteLibrary.notebooks.find(
    (item) => item.id === note?.notebookId,
  );
  const editorMaterial = noteEditor?.source
    ? relations.material(noteEditor.source)
    : null;
  function openNote(item: Note) {
    setNoteId(item.id);
    setView("notes");
  }
  function startNote(source: LearningLocation) {
    setNoteEditor({
      id: `note-${crypto.randomUUID()}`,
      source: structuredClone(source),
    });
  }
  function relatedContent(source: LearningLocation) {
    return (
      <RelatedLearning
        source={source}
        relations={relations}
        onConversation={(item) =>
          openConversation(item, item.status === "active")
        }
        onNote={openNote}
        onCreateNote={startNote}
      />
    );
  }
  // 对话页与阅读页共用明确的页码，不推断旧章节位置。
  const linkedLocation =
    view === "conversations" && currentConversation
      ? readingLocationForConversation(readingState, currentConversation)
      : {
          selection: view === "reading" ? selection : null,
          material: view === "materials" ? data.materialSelection : null,
        };
  const linkedReading =
    linkedLocation.material || linkedLocation.selection
      ? relations.material(linkedLocation.material ?? linkedLocation.selection!)
      : null;
  const chatSelection =
    linkedReading && !("materialId" in linkedReading.source)
      ? linkedReading.source
      : null;
  const materialLocation =
    linkedReading && "materialId" in linkedReading.source
      ? linkedReading.source
      : null;
  const draftConversationId =
    currentConversation?.id ??
    (view === "conversations" ? activeConversationId : null);
  const chatDraftKey = draftConversationId
    ? `conversation:${draftConversationId}`
    : chatSelection
      ? readingKey(chatSelection)
      : materialLocation
        ? readingDocumentKey(materialLocation)
        : "ordinary-chat";
  function prepareReload() {
    const currentSaveState = readSaveState();
    if (currentSaveState !== "saved" || submitting.current)
      throw new Error(
        currentSaveState === "saving" || submitting.current
          ? "正在保存当前内容，请稍后再更新应用。"
          : "本页更改尚未保存，请先重试保存。",
      );
    if (
      data!.robots.some((robot) =>
        isRobotModified(robot, robotDrafts[robot.id]),
      )
    )
      throw new Error("机器人配置尚未保存，请先保存或取消修改，再更新应用。");
    if (formDrafts.snapshot().activeCount > 0)
      throw new Error("表单内容尚未保存，请先保存或取消修改，再更新应用。");
    saveReloadCheckpoint({
      schemaVersion: 1,
      conversationId: currentConversation?.id ?? null,
      drafts: chatDrafts,
      reading: readingState,
    });
  }
  const contextLabel = linkedReading?.readingLabel ?? null;

  function selectMaterial(next: MaterialLocation) {
    const sameReader =
      view === "materials" &&
      data!.materialSelection?.materialId === next.materialId &&
      data!.materialSelection.contentVersion === next.contentVersion;
    const conversation = conversationForMaterial(
      data!.conversations,
      next,
      activeConversationId,
    );
    updateData((previous) => ({ ...previous, materialSelection: { ...next } }));
    setActiveConversationId(conversation?.id ?? null);
    if (conversation || !sameReader)
      setActiveRobotId(conversation?.robotId ?? null);
    setView("materials");
  }

  function openReference(reference: ReadingReference) {
    const source = reference.material ?? reference.selection;
    if (!source || !isSupportedReadingLocation(source)) {
      setCommandError(UNSUPPORTED_READING_REFERENCE);
      return;
    }
    if (reference.material) {
      updateData((previous) => ({
        ...previous,
        materialSelection: { ...reference.material! },
      }));
      setView("materials");
    } else if (reference.selection) {
      updateData((previous) => ({
        ...previous,
        selection: { ...reference.selection! },
      }));
      setView("reading");
    }
  }

  function selectContent(next: ReadingSelection) {
    const sameReader =
      view === "reading" &&
      data!.selection.courseId === next.courseId &&
      data!.selection.version === next.version &&
      data!.selection.kind === "textbooks" &&
      next.kind === "textbooks" &&
      data!.selection.itemId === next.itemId;
    const conversation = conversationForReading(
      data!.conversations,
      next,
      activeConversationId,
    );
    updateData((previous) => ({ ...previous, selection: next }));
    setActiveConversationId(conversation?.id ?? null);
    if (conversation || !sameReader)
      setActiveRobotId(conversation?.robotId ?? null);
    setView("reading");
  }

  async function createSubject(title: string): Promise<Subject> {
    const id = `subject-${crypto.randomUUID()}`;
    const saved = await saveChanges((previous) =>
      addSubject(previous, sourceCourses, title, id),
    );
    showSaved("学科已创建");
    return saved.subjects!.find((item) => item.id === id)!;
  }
  async function changeSubjectName(id: string, title: string) {
    await saveChanges((previous) =>
      renameSubject(previous, sourceCourses, id, title),
    );
    showSaved("学科名称已保存");
  }
  async function deleteSubject(id: string) {
    await officialService.removeSubject(id);
    if (libraryScope.courseId === id)
      setLibraryScope({ courseId: null, kind: "textbooks" });
    showSaved("学科已删除");
  }
  async function deleteOfficial(id: string) {
    await officialService.remove(id);
    showSaved("资料已删除");
  }
  async function readOfficial(
    id: string,
    previous?: ReadingSelection,
    requireDownload = false,
  ) {
    try {
      const target = await officialService.read(id, previous, requireDownload);
      selectContent(restoreReadingLocation(readingState, target));
    } catch (error) {
      setCommandError(
        error instanceof Error ? error.message : "无法打开资料，请刷新后重试。",
      );
    }
  }

  function selectCourse(
    courseId: CourseId | null,
    kind: ReadingSelection["kind"],
  ) {
    setLibraryScope({ courseId, kind });
    setView("library");
  }

  function returnToList() {
    const scope =
      view === "materials" && data!.materialSelection
        ? scopeForMaterial(
            data!.materialSelection,
            materials.items,
            subjectDirectory,
          )
        : officialLibrary.scopeForSelection(selection);
    if (!scope) {
      setView("content");
      return;
    }
    setLibraryScope(scope);
    setView("library");
  }

  const sidebarScope =
    view === "library"
      ? libraryScope
      : view === "reading"
        ? officialLibrary.scopeForSelection(selection)
        : view === "materials" && data.materialSelection
          ? scopeForMaterial(
              data.materialSelection,
              materials.items,
              subjectDirectory,
            )
          : null;

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
    const source = saved.material ?? saved.selection;
    if (returnToReading && source && !isSupportedReadingLocation(source)) {
      setCommandError(UNSUPPORTED_READING_REFERENCE);
      return;
    }
    conversation = saved;
    const target = returnToReading
      ? readingLocationForConversation(readingState, conversation)
      : conversation;
    const nextSelection = target.selection;
    const nextMaterial = target.material;
    if (nextSelection || nextMaterial)
      updateData((previous) => ({
        ...previous,
        ...(nextSelection ? { selection: { ...nextSelection } } : {}),
        ...(nextMaterial ? { materialSelection: { ...nextMaterial } } : {}),
      }));
    setActiveConversationId(conversation.id);
    setActiveRobotId(conversation.robotId);
    setView(
      returnToReading && conversation.material
        ? "materials"
        : returnToReading && conversation.selection
          ? "reading"
          : "conversations",
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
        materialLocation,
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

  async function saveQuestion(
    text: string,
    retryMessageId?: string,
    restartBinding?: SessionBinding,
  ) {
    if (!currentRobot) throw new Error("请先选择机器人。");
    if (submitting.current) throw new Error("消息正在保存，请稍后重试。");
    if (currentConversation?.status === "archived")
      throw new Error("对话已归档，请先移回进行中。");
    if (currentConversation?.turns.some((turn) => turn.status === "running"))
      throw new Error("此对话正在生成，请稍后提问。");
    if (!retryMessageId) validateReferenceCount(draftReferences);
    submitting.current = true;
    try {
      const selected =
        currentConversation ??
        createConversation(
          data!,
          chatSelection,
          currentRobot.id,
          ai.settings,
          "new",
          null,
          materialLocation,
        );
      const turnId = crypto.randomUUID(),
        messageId = retryMessageId ?? crypto.randomUUID(),
        createdAt = Date.now();
      const references = retryMessageId
        ? []
        : draftReferences.map((item) => item.reference);
      const original = retryMessageId
        ? currentConversation?.messages.find(
            (message) => message.id === retryMessageId,
          )
        : undefined;
      let readingContext = retryMessageId
        ? original?.readingContext
        : linkedReading?.contextReference();
      let contextError = "";
      if (
        readingContext &&
        (!retryMessageId || !readingContext.content.trim())
      ) {
        const location = readingContext.material ?? readingContext.selection;
        try {
          if (!location)
            throw new Error("关联位置已失效，请重新打开资料后提问。");
          readingContext = await relations
            .material(location)
            .readContext(materialApi.page);
        } catch (error) {
          contextError =
            error instanceof Error
              ? error.message
              : "关联内容读取失败，请重试。";
        }
      }
      const saved = await saveChanges((previous) =>
        recordQuestion(
          previous,
          {
            conversation: selected,
            robotId: currentRobot.id,
            messageId,
            turnId,
            text,
            references,
            createdAt,
            retry: !!retryMessageId,
            create: !currentConversation,
            readingContext,
            contextError,
            expectedBinding: restartBinding,
          },
          ai.settings,
        ),
      );
      const sentIds = new Set(draftReferences.map((item) => item.id));
      if (!retryMessageId && sentIds.size)
        updateReferences(referenceDraftKey, (previous) =>
          previous.filter((item) => !sentIds.has(item.id)),
        );
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
      const attempt = conversation.turns.find((item) => item.id === turnId)!;
      const question = conversation.messages.find(
        (item) => item.id === messageId,
      )!;
      const targetBinding = activeSessionBinding(conversation);
      if (attempt.status === "running")
        void ai
          .start({
            id: turnId,
            conversationId: conversation.id,
            connectionId: resolved.connectionId,
            ...(resolved.connectionRevision
              ? { connectionRevision: resolved.connectionRevision }
              : {}),
            ...(targetBinding?.externalSessionId
              ? {
                  externalSessionId: targetBinding.externalSessionId,
                  bindingRevision: targetBinding.revision,
                }
              : {}),
            conversationSnapshot: conversationMetadata(conversation),
            robotRevision: teacher.revision,
            client: clientRuntime(),
            userMessageId: messageId,
            ...(restartBinding ? { restartSession: true } : {}),
            text: question.content,
            teacher: {
              id: teacher.id,
              name: teacher.name,
              prompt: teacher.prompt,
              icon: teacher.icon,
            },
            model: resolved.model,
            reasoningEffort: resolved.reasoningEffort,
            reference: null,
            ...(question.readingContext
              ? { readingContext: question.readingContext }
              : {}),
            references: messageReferences(question),
            history: conversation.messages
              .slice(
                0,
                conversation.messages.findIndex(
                  (item) => item.id === messageId,
                ),
              )
              .slice(-24)
              .map((item) => ({
                id: item.id,
                role: item.role,
                content: item.content.slice(-5000),
                ...(item.readingContext &&
                isSupportedReadingReference(item.readingContext)
                  ? { readingContext: item.readingContext }
                  : {}),
                references: messageReferences(item).filter(
                  isSupportedReadingReference,
                ),
              })),
          })
          .catch((error) =>
            setCommandError(
              error instanceof Error ? error.message : "读取 AI 执行结果失败。",
            ),
          );
    } finally {
      submitting.current = false;
    }
  }

  function retryQuestion(messageId: string) {
    const turn = currentConversation?.turns.find(
      (item) =>
        item.id ===
        currentConversation.messages.find((message) => message.id === messageId)
          ?.turnId,
    );
    const binding = currentConversation
      ? activeSessionBinding(currentConversation)
      : null;
    if (
      turn?.errorCode === "session_missing" &&
      binding?.state === "missing" &&
      turn.connectionId === binding.connectionId
    ) {
      setPendingSwitch({
        kind: "session",
        confirm: () => saveQuestion("", messageId, structuredClone(binding)),
      });
      return Promise.resolve();
    }
    return saveQuestion("", messageId);
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
          currentConversation?.id,
        );
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
      setAiSettingsSource(null);
      showSaved();
    };
    if (currentConversation && before.connectionId !== after.connectionId) {
      setAiSettingsSource(null);
      const kind = serviceSwitchKind(currentConversation, after.connectionId);
      if (kind) setPendingSwitch({ kind, confirm: commit });
      else await commit();
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
      <SubjectDialog
        subjects={subjects}
        action={subjectAction}
        onClose={() => setSubjectAction(null)}
        onCreate={createSubject}
        onRename={changeSubjectName}
        onDelete={deleteSubject}
      />
      <ConversationSwitchDialog
        pending={pendingSwitch}
        onClose={() => setPendingSwitch(null)}
      />
      <div className={styles.shell}>
        <Sidebar
          subjects={subjects}
          onSubjectAction={setSubjectAction}
          ai={ai}
          robot={currentRobot}
          robotAiConfig={chatDefaults}
          onRobotAiSave={saveRobotAi}
          aiSettingsSource={aiSettingsSource}
          onAiSettingsSourceChange={setAiSettingsSource}
          view={view}
          activeScope={sidebarScope}
          settings={data.settings}
          teachingActivity={teachingActivity}
          onSelectTeachingActivity={setTeachingActivity}
          onNavigate={(next) => {
            if (next === "conversations") {
              const conversation =
                currentConversation ??
                data.conversations.find(
                  (item) =>
                    item.id === activeConversationId &&
                    item.status !== "deleted",
                ) ??
                latestConversation(data.conversations);
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
          <ResizableColumns
            key={resizable ? "split" : "static"}
            className={styles.columns}
            hidden={
              view === "robots" || view === "content" || view === "teaching"
            }
            enabled={resizable}
            separatorLabel={
              view === "notes" ? "调整笔记列表与正文宽度" : undefined
            }
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
                onAddReference={addReference}
                key={`reader:${selection.courseId}:${selection.version}:${selection.kind}:${selection.itemId}:${selection.kind === "textbooks" ? "pdf" : selection.chapterIndex}`}
                availableCourses={availableCourses}
                loadPdf={content.readPdf}
                zoom={readingState.documents[documentKey]?.zoom ?? 1}
                onZoomChange={setReadingZoom}
                continuous={
                  readingState.documents[documentKey]?.continuous ?? true
                }
                onContinuousChange={setReadingContinuous}
                onPageScroll={savePdfScroll}
                removed={!officialLibrary.scopeForSelection(selection)}
                historical={officialLibrary.isHistorical(selection)}
                selection={selection}
                fontSize={data.settings.fontSize}
                onChange={selectContent}
                onBack={returnToList}
                position={readingPosition}
                onPositionChange={setReadingPosition}
                relatedContent={relatedContent(selection)}
              />
            )}
            {view === "materials" && (
              <Suspense fallback={<p role="status">正在打开资料阅读器…</p>}>
                <MaterialReader
                  onAddReference={addReference}
                  library={materials}
                  location={data.materialSelection ?? null}
                  onChange={selectMaterial}
                  onBack={returnToList}
                  position={readingPosition}
                  onPageScroll={savePdfScroll}
                  continuous={
                    readingState.documents[documentKey]?.continuous ?? true
                  }
                  onContinuousChange={setReadingContinuous}
                  zoom={readingState.documents[documentKey]?.zoom ?? 1}
                  onZoomChange={setReadingZoom}
                  relatedContent={
                    data.materialSelection
                      ? relatedContent(data.materialSelection)
                      : undefined
                  }
                />
              </Suspense>
            )}
            {view === "library" && (
              <SubjectContentList
                scope={libraryScope}
                directory={subjectDirectory}
                onCreateSubject={createSubject}
                onUploaded={(courseId) =>
                  setLibraryScope({ courseId, kind: "textbooks" })
                }
                official={officialLibrary}
                onRemoveOfficial={deleteOfficial}
                library={materials}
                selection={selection}
                materialSelection={data.materialSelection ?? null}
                onOpen={(location) =>
                  void readOfficial(officialEntryId(location), location)
                }
                onOpenMaterial={(location) =>
                  selectMaterial(restoreReadingLocation(readingState, location))
                }
              />
            )}
            {view === "library" && (
              <section
                className={styles.libraryWelcome}
                aria-label="学习讨论提示"
              >
                <NotebookPen aria-hidden="true" />
                <h2>
                  {libraryScope.kind === "textbooks"
                    ? "打开学习资料，开始讨论"
                    : "选择题目，开始讨论"}
                </h2>
                <p>
                  {libraryScope.kind === "textbooks"
                    ? "在左侧列表中打开资料，即可围绕阅读内容提问。"
                    : "在左侧列表中打开题目，即可查看内容、参考答案并提问。"}
                </p>
              </section>
            )}
            {view === "conversations" && (
              <ConversationList
                relations={relations}
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
                  const target = data.conversations.find(
                    (item) => item.id === id,
                  );
                  const binding = target ? activeSessionBinding(target) : null;
                  await saveChanges((previous) =>
                    updateConversation(previous, id, change, revision),
                  );
                  if (change.title !== undefined) {
                    if (!binding?.externalSessionId) {
                      showSaved("名称已保存");
                      return;
                    }
                    try {
                      const result = await localAi.renameSession(
                        id,
                        change.title,
                        binding,
                      );
                      showSaved(
                        result.status === "synced"
                          ? "名称已保存，第三方会话已同步改名"
                          : "名称已保存，当前服务不支持同步改名",
                      );
                    } catch (error) {
                      throw new Error(
                        `本地名称已保存。第三方同步失败：${error instanceof Error ? error.message : "请求失败。"}可再次保存重试。`,
                        { cause: error },
                      );
                    }
                  }
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
              <NotebookList
                library={noteLibrary}
                directory={subjectDirectory}
                activeNoteId={note?.id ?? null}
                onSelect={setNoteId}
                onAction={async (action) => {
                  await saveChanges((previous) =>
                    applyNoteAction(
                      previous,
                      createSubjectDirectory(sourceCourses, previous.subjects),
                      action,
                    ),
                  );
                }}
              />
            )}
            {view === "notes" && (
              <section
                className={styles.note}
                aria-label="笔记阅读区"
                key={note?.id ?? "empty"}
              >
                <PaneHeader
                  icon={NotebookPen}
                  title={noteNotebook?.title ?? "笔记"}
                  detail={
                    noteMaterial && (
                      <button
                        type="button"
                        className={styles.noteSource}
                        aria-label="查看原文"
                        title={`来源：${noteMaterial.title} · ${noteMaterial.position}${noteMaterial.removed ? "（资料已从列表删除）" : ""}`}
                        disabled={!noteMaterial.available}
                        onClick={() => {
                          if (noteSource && "materialId" in noteSource)
                            selectMaterial({ ...noteSource });
                          else if (noteSource) selectContent({ ...noteSource });
                        }}
                      >
                        <Link aria-hidden="true" />
                        <span>
                          {noteMaterial.title} · {noteMaterial.position}
                          {noteMaterial.removed && "（资料已从列表删除）"}
                        </span>
                      </button>
                    )
                  }
                  actions={
                    note && (
                      <button
                        type="button"
                        onClick={() =>
                          setNoteEditor({
                            id: note.id,
                            note: structuredClone(note),
                            source: sourceForNote(note),
                          })
                        }
                      >
                        <SquarePen aria-hidden="true" />
                        编辑笔记
                      </button>
                    )
                  }
                />
                <div className={styles.noteViewport}>
                  {note ? (
                    <article
                      className={styles.notePaper}
                      aria-label="笔记正文"
                      style={{ fontSize: data.settings.fontSize }}
                    >
                      <header className={styles.noteHeading}>
                        <h1>{note.title}</h1>
                      </header>
                      {noteDisplayTagIds.length > 0 && (
                        <div className={styles.noteTags}>
                          {noteDisplayTagIds.map((id) => (
                            <span key={id}>
                              {noteTags(noteLibrary, subjectDirectory).find(
                                (tag) => tag.id === id,
                              )?.title ?? "标签不可用"}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={styles.noteBody}>
                        <Markdown>{note.content}</Markdown>
                      </div>
                    </article>
                  ) : (
                    <div className={styles.noteEmpty}>
                      <NotebookPen aria-hidden="true" />
                      <h2>暂无笔记</h2>
                      <p>可以在左侧展开笔记本查看内容。</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {(view === "reading" ||
              view === "conversations" ||
              view === "materials") && (
              <ChatPanel
                key={`chat:${chatDraftKey}`}
                draft={chatDrafts[chatDraftKey] ?? ""}
                onDraftChange={(draft) => {
                  setChatDrafts((previous) => ({
                    ...previous,
                    [chatDraftKey]: draft,
                  }));
                  updateData((previous) => ({
                    ...previous,
                    drafts: { ...previous.drafts, [chatDraftKey]: draft },
                  }));
                }}
                robots={data.robots}
                robotId={currentRobot?.id ?? null}
                conversation={currentConversation}
                contextLabel={contextLabel}
                recommendationsExpanded={recommendationsExpanded}
                onToggleRecommendations={() =>
                  setRecommendationsExpanded((expanded) => !expanded)
                }
                onRobotChange={changeRobot}
                onSend={saveQuestion}
                onRetryMessage={retryQuestion}
                onOpenReference={openReference}
                references={draftReferences}
                onRemoveReference={(id) =>
                  updateReferences(referenceDraftKey, (previous) =>
                    previous.filter((item) => item.id !== id),
                  )
                }
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
              library={officialLibrary}
              operation={officialOperation}
              onRemove={deleteOfficial}
              onInstall={async (id, update) => {
                const saved = await officialService.acquire(id, update);
                if (saved) showSaved("资料已保存");
                return saved;
              }}
              onRead={(id) => readOfficial(id, selection, true)}
            />
          )}
          {view === "teaching" && (
            <section
              className={styles.teachingRoom}
              aria-label={selectedTeachingActivity.title}
            >
              <h1>{selectedTeachingActivity.title}</h1>
            </section>
          )}
          <div className={styles.robots} hidden={view !== "robots"}>
            <RobotsPage
              robots={data.robots}
              defaultRobotId={data.defaultRobotId}
              onChange={changeRobots}
              onUse={newConversation}
              aiSettings={ai.settings}
              drafts={robotDrafts}
              onDraftsChange={setRobotDrafts}
            />
          </div>
        </section>
      </div>
      {noteEditor && (
        <NoteEditorDialog
          key={noteEditor.id}
          target={noteEditor}
          library={noteLibrary}
          sourceLabel={
            editorMaterial
              ? `${editorMaterial.title} · ${editorMaterial.position}`
              : ""
          }
          onClose={() => setNoteEditor(null)}
          onSave={async (value, revision) => {
            const target = noteEditor;
            await saveChanges((previous) => {
              if (target.note)
                return editNote(previous, target.id, value, revision);
              const official = new OfficialLibrary(readSnapshot(), previous);
              const material = target.source
                ? new LearningMaterial(
                    target.source,
                    readSnapshot().allCourses,
                    materials.items,
                    official,
                  )
                : null;
              return createNote(
                previous,
                value,
                target.source,
                material?.subjectId ?? null,
                target.id,
              );
            });
            setNoteId(target.id);
            setView("notes");
            showSaved("笔记已保存");
          }}
        />
      )}
      <footer className={styles.footer}>
        {commandError && <span role="alert">{commandError}</span>}
        <span
          role={
            saveState === "error" || !storageStatus.online ? "alert" : "status"
          }
        >
          {conflict
            ? "最新记录已变化，未保存内容仍保留，请核对修改冲突"
            : saveState === "saving"
              ? "正在保存到本地…"
              : saveState === "error"
                ? saveError || "本次更改尚未保存，请重试"
                : !storageStatus.online
                  ? "本机服务未连接，正在查看缓存"
                  : "已保存在 user 目录"}
        </span>
        {storageStatus.warning && (
          <span role="alert">{storageStatus.warning}</span>
        )}
        {refreshError && <span role="alert">{refreshError}</span>}
        {saveState === "error" && !conflict && (
          <button onClick={retrySave}>重试保存</button>
        )}
        {reloadCheckpoint.error && (
          <span role="alert">{reloadCheckpoint.error}</span>
        )}
        {view === "conversations" &&
          activeConversationId &&
          data.conversations.some(
            (item) =>
              item.id === activeConversationId && item.status === "deleted",
          ) && (
            <span role="alert">
              原对话已删除，输入草稿仍保留；继续提问将创建新对话。
            </span>
          )}
        <RefreshControls
          data={data}
          conflicts={conflicts}
          recoveries={recoveries}
          onResolve={(index, choice) => {
            const item = conflicts[index];
            resolveConflict(index, choice);
            if (choice === "remote" && item?.path[0] === "drafts") {
              setChatDrafts((previous) => {
                const next = { ...previous };
                const key = item.path[1];
                if (key) {
                  if (typeof item.remote === "string") next[key] = item.remote;
                  else delete next[key];
                }
                return next;
              });
            }
          }}
          chatDrafts={chatDrafts}
        />
        <PwaControls prepareReload={prepareReload} />
      </footer>
    </main>
  );
}
