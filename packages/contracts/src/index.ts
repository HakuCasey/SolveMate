export type CourseId = string;

export interface ReadingSelection {
  version?: string;
  courseId: CourseId;
  kind: "questions" | "textbooks";
  itemId: string;
  chapterIndex: number;
}

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

export interface Robot {
  id: string;
  name: string;
  // 专业范围用于说明教师的侧重，不限制用户选择或跨学科提问。
  specialty?: string;
  description: string;
  icon: "graduation-cap" | "sparkles" | "bot";
  prompt: string;
  modelSource: "global" | "custom";
  modelName: string;
  temperature: number;
  memoryEnabled: boolean;
  courseMemory: boolean;
  skills: ("questions" | "textbooks" | "notes")[];
}

export interface Message {
  createdAt?: number;
  turnId?: string;
  externalItemId?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  botId?: string | null;
  botName?: string;
  botIcon?: Robot["icon"];
  example?: boolean;
}

export interface SessionBinding {
  // 连接配置只保存引用；凭据不放进会话记录。
  connectionId: string;
  protocol: "codex-app-server" | "opencode" | "openclaw" | "hermes" | "api";
  externalSessionId: string;
}

export interface SessionTurn {
  // 一轮实际执行独立于列表中的“进行中／已归档”分类。
  id: string;
  connectionId: string;
  externalTurnId?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  completedAt?: number;
}

export interface Conversation {
  // Conversation 是 SolveMate 的本地 session，id 不随机器人或外部连接改变。
  createdAt?: number;
  archivedAt?: number;
  deletedAt?: number;
  bindings?: SessionBinding[];
  turns?: SessionTurn[];
  label?: string;
  archived?: boolean;
  id: string;
  title: string;
  // 普通对话不关联阅读内容，显式保存为 null。
  selection: ReadingSelection | null;
  robotId: string | null;
  messages: Message[];
  updatedAt: number;
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
}

export interface AppData {
  schemaVersion: 1;
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
