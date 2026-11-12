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
  chapters: Chapter[];
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

/** 学科分类独立于官方课程包；删除标记用于保留原资料和历史记录的关联。 */
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
} from "./metadata";
import type {
  ReadingSelection,
  Robot,
  ConversationMetadata,
  SessionBinding,
  SessionTurn,
  ReadingReference,
  MaterialLocation,
} from "./ai-metadata.generated";

export interface Message {
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
  model?: string;
}

export interface Conversation extends ConversationMetadata {
  binding: SessionBinding | null;
  turns: SessionTurn[];
  messages: Message[];
  example: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  revision: number;
}

export interface Note {
  id: string;
  notebookId: string;
  courseId: CourseId;
  questionId: string;
  title: string;
  summary: string;
  content: string;
  revision: number;
  tagIds: string[];
}

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
  fontSize: number;
  appearance: "light" | "dark";
  globalModel: string;
  readingPaneRatio?: number;
}

export interface AppData {
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
