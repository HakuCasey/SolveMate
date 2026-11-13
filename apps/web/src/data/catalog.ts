import type {
  AppData,
  Course,
  CourseId,
  CurrentContent,
  Note,
  Notebook,
  ReadingSelection,
} from "@solvemate/contracts";
import calculusQuestions from "../../../../data/calculus/questions/questions.json";
import calculusMarkdown from "../../../../data/calculus/textbooks/primer.md?raw";
import calculusLearning from "../../../../data/calculus/memory/learning-points.json";
import calculusDiscussion from "../../../../data/calculus/memory/discussion-points.json";
import cQuestions from "../../../../data/c-language/questions/questions.json";
import cMarkdown from "../../../../data/c-language/textbooks/primer.md?raw";
import cLearning from "../../../../data/c-language/memory/learning-points.json";
import cDiscussion from "../../../../data/c-language/memory/discussion-points.json";
import seedData from "./seed-data.json";
import { bundledTextbookPdf } from "./textbook-pdfs";
import { parseTextbook } from "./textbooks";
import { requireReadingLocation } from "../reading/reference";
import { migrateAiMetadata } from "./migrate-ai-metadata";
import { initializeNotes } from "../state/notes";

// 全科教师的指令同时用于新建机器人，保持通用要求一致。
export const defaultTeacherPrompt = seedData.robots.find(
  (robot) => robot.id === "scholar",
)!.prompt;

// 数据随首版应用一起构建，应用缓存完成后不再依赖内容服务器读取这些示例。
export const courses: Course[] = [
  {
    id: "calculus",
    title: calculusQuestions.course,
    version: "example-1",
    questions: calculusQuestions.questions,
    textbooks: [
      {
        ...parseTextbook("B001", calculusMarkdown),
        pdf: bundledTextbookPdf("B001")!.metadata,
      },
    ],
    memory: {
      learningPoints: calculusLearning.points,
      discussionPoints: calculusDiscussion.points,
    },
  },
  {
    id: "c-language",
    title: cQuestions.course,
    version: "example-1",
    questions: cQuestions.questions,
    textbooks: [
      {
        ...parseTextbook("CB001", cMarkdown),
        pdf: bundledTextbookPdf("CB001")!.metadata,
      },
    ],
    memory: {
      learningPoints: cLearning.points,
      discussionPoints: cDiscussion.points,
    },
  },
];

export function getCourse(
  id: CourseId,
  version?: string,
  available = courses,
): Course {
  const course = available.find(
    (item) => item.id === id && (!version || item.version === version),
  );
  if (!course) throw new Error(`Course was not found: ${id}`);
  return course;
}

export const sampleNotebooks: Notebook[] = seedData.notebooks.map((item) => ({
  ...item,
  revision: 1,
}));

export const sampleNotes: Note[] = seedData.notes.map((note) => {
  if (!sampleNotebooks.some((notebook) => notebook.id === note.notebookId))
    throw new Error(`Sample note has an unknown notebook: ${note.id}`);
  const course = courses.find((item) => item.id === note.courseId);
  if (!course) throw new Error(`Sample note has an unknown course: ${note.id}`);
  return {
    ...note,
    courseId: course.id,
    revision: 1,
    tagIds: [`subject:${course.id}`],
  };
});

export function createInitialData(): AppData {
  const data: unknown = {
    schemaVersion: 1,
    robotCatalogVersion: 1,
    robots: seedData.robots,
    defaultRobotId: "scholar",
    conversations: seedData.conversations,
    settings: {
      fontSize: 14,
      appearance:
        typeof matchMedia === "function" &&
        matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      globalModel: "",
    },
    selection: {
      courseId: "calculus",
      kind: "questions",
      itemId: "M001",
      chapterIndex: 0,
    },
  };
  const initial = migrateAiMetadata(data);
  initial.selection.version = "example-1";
  initial.conversations.forEach((session) => {
    if (session.selection) session.selection.version = "example-1";
  });
  return initializeNotes(initial, sampleNotebooks, sampleNotes);
}

export function getCurrentContent(
  selection: ReadingSelection,
  available = courses,
): CurrentContent {
  requireReadingLocation(selection);
  const course = getCourse(selection.courseId, selection.version, available);
  if (selection.kind === "questions") {
    const question = course.questions.find(
      (item) => item.id === selection.itemId,
    );
    if (!question)
      throw new Error(`Question was not found: ${selection.itemId}`);
    return {
      ...question,
      courseId: course.id,
      kind: "questions",
      content: question.question,
    };
  }

  const book = course.textbooks.find((item) => item.id === selection.itemId);
  if (!book?.pdf)
    throw new Error(`Textbook PDF was not found: ${selection.itemId}`);
  const pageNumber = selection.pageNumber!;
  const page = book.pdf.pages[pageNumber - 1];
  if (page === undefined)
    throw new Error(`Textbook page was not found: ${pageNumber}`);
  return {
    id: `${book.id}:page:${pageNumber}`,
    courseId: course.id,
    kind: "textbooks",
    title: `第 ${pageNumber} 页`,
    topic: book.title,
    difficulty: "学习资料",
    content: page,
    answer: "",
    explanation: "",
  };
}

/** 恢复前检查内容引用，失效记录交由读取失败界面处理，避免进入页面后抛错。 */
export function validateContentReferences(
  data: AppData,
  available = courses,
): void {
  getCurrentContent(data.selection, available);
  for (const conversation of data.conversations) {
    if (conversation.selection)
      getCurrentContent(conversation.selection, available);
  }
}
