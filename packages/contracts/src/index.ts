import limits from "../conversation-limits.json";
import robotLimits from "../robot-limits.json";

export const conversationLimits = limits;
export const maxRobots = robotLimits.maxCount;

export type CourseId = string;

export interface Question {
  id: string;
  title: string;
  topic: string;
  difficulty: string;
  question: string;
  answer: string;
  explanation: string;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface Textbook {
  id: string;
  title: string;
  description?: string;
  chapters: Chapter[];
  /** PDF 与逐页文字属于同一固定版本，旧内容包不含此字段。 */
  pdf?: {
    path: string;
    pages: string[];
    chapterPages: number[];
  };
}

export interface MemorySource {
  textbook: string;
  question_ids: string[];
}

export interface LearningPoint {
  id: string;
  title: string;
  content: string;
  common_mistake: string;
  source: MemorySource;
}

export interface DiscussionPoint {
  id: string;
  title: string;
  prompts: string[];
  guidance: string;
  source: MemorySource;
}

export interface Course {
  id: CourseId;
  title: string;
  version: string;
  questions: Question[];
  textbooks: Textbook[];
  memory: {
    learningPoints: LearningPoint[];
    discussionPoints: DiscussionPoint[];
  };
}

/** 学科分类独立于社区课程包；删除标记用于保留原资料和历史记录的关联。 */
export interface Subject {
  id: CourseId;
  title: string;
  deleted: boolean;
  /** 同时移除上传资料条目；缺少此字段的旧记录仍按仅删除分类处理。 */
  materialsDeleted?: boolean;
}

export type * from "./ai-metadata.generated";
export {
  assertMetadata,
  assertLegacyMetadataV2,
  aiMetadataSchema,
  assertUserData,
  assertNoteMetadata,
  maxNoteTitleLength,
  maxUserNameLength,
  maxPetNameLength,
  maxSignatureLength,
  truncateNoteTitle,
} from "./metadata";
import type {
  ReadingSelection,
  Robot,
  ConversationMetadata,
  SessionBinding,
  SessionTurn,
  ReadingReference,
  MaterialLocation,
  QuestionResearchContext,
  ResearchResource,
  TeachingTool,
} from "./ai-metadata.generated";

export interface Message {
  research?: QuestionResearchContext;
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  turnId?: string;
  externalItemId?: string;
  botId?: string | null;
  botName?: string;
  botIcon?: Robot["icon"];
  example?: boolean;
  reference?: ReadingReference;
  references?: ReadingReference[];
  readingContext?: ReadingReference;
  model?: string;
}

export interface Conversation extends ConversationMetadata {
  binding: SessionBinding | null;
  /** 每项服务分别保存关联；binding 仅用于读取旧记录。 */
  bindings?: SessionBinding[];
  turns: SessionTurn[];
  messages: Message[];
  example: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  revision: number;
}

/** 固定资料版本及其阅读位置，供对话引用和笔记来源复用。 */
export type LearningLocation = ReadingSelection | MaterialLocation;

/** 资料来源固定到版本与位置，对话来源固定到消息编号；原文由来源对象维护。 */
export type NoteOrigin =
  | {
      kind: "document";
      materialId: string;
      version: string;
      pageNumber: number;
    }
  | {
      kind: "question";
      materialId: string;
      version: string;
      questionId: string;
    }
  | {
      kind: "conversation";
      conversationId: string;
      messageIds: [string, ...string[]];
    };

export interface Note {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  tagIds: string[];
  revision: number;
  /** Unix 毫秒；旧记录没有可靠时间时为 null，不使用迁移时间冒充。 */
  createdAt: number | null;
  updatedAt: number | null;
  origins: NoteOrigin[];
}

export {
  migrateNoteMetadata,
  originsFromReading,
  locationForOrigin,
  uniqueNoteOrigins,
} from "./note-metadata";

export interface NoteTag {
  id: string;
  title: string;
}

export interface NoteLibrary {
  notebooks: Notebook[];
  notes: Note[];
  customTags: NoteTag[];
}

export interface Settings {
  userName?: string;
  profileAvatar?: string | null;
  profileSignature?: string;
  /** 未设置时使用默认宠物；null 表示尚未领养。 */
  petName?: string | null;
  /** 题目与笔记字号，旧记录也用此值初始化对话字号。 */
  fontSize: number;
  chatFontSize?: number;
  appearance: "light" | "dark";
  themeId?: string;
  globalModel: string;
  readingPaneRatio?: number;
}

export interface QuestionResearchWorkspace {
  source: LearningLocation | null;
  conversationId: string | null;
  context: QuestionResearchContext;
  /** 仅用于读取早期自定义模板，新工具统一保存在 tools 中。 */
  templates: ResearchResource[];
  tools?: TeachingTool[];
  selectedToolId?: string | null;
}

export interface AppData {
  questionResearch?: QuestionResearchWorkspace;
  schemaVersion: 3;
  robotCatalogVersion?: 1;
  robots: Robot[];
  defaultRobotId: string | null;
  conversations: Conversation[];
  settings: Settings;
  selection: ReadingSelection;
  materialSelection?: MaterialLocation | null;
  subjects?: Subject[];
  noteLibrary?: NoteLibrary;
  readingProgress?: ReadingProgress;
  drafts?: Record<string, string>;
}

/** 跨浏览器保存的阅读位置；选区、弹窗和当前页面由窗口自己管理。 */
export interface ReadingProgress {
  positions: Record<
    string,
    { scroll: { top: number; left: number }; answerVisible: boolean }
  >;
  documents: Record<
    string,
    {
      zoom: number;
      continuous?: boolean;
      location?: ReadingSelection | MaterialLocation;
    }
  >;
}

export interface CurrentContent {
  id: string;
  courseId: CourseId;
  kind: ReadingSelection["kind"];
  title: string;
  topic: string;
  difficulty: string;
  content: string;
  answer: string;
  explanation: string;
}

export { conversationMetadata } from "./conversation";

/** 学习统计独立于整份页面记录保存，重复时间段由本机服务合并。 */
export interface StudyInterval {
  startMs: number;
  endMs: number;
}
export interface StudySummary {
  storeId: string;
  today: string;
  days: { date: string; milliseconds: number }[];
}
