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
  reference?: { title: string; content: string; selection: ReadingSelection };
  model?: string;
}

export interface Conversation extends ConversationMetadata {
  binding: SessionBinding | null;
  turns: SessionTurn[];
  messages: Message[];
  example: boolean;
}

export interface Note {
  id: string;
  courseId: CourseId;
  questionId: string;
  title: string;
  summary: string;
  content: string;
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
