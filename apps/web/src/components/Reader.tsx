import { useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  Course,
  CurrentContent,
  ReadingSelection,
} from "@solvemate/contracts";
import { getCourse, getCurrentContent } from "../data/catalog";
import { Markdown } from "./Markdown";
import styles from "./Reader.module.css";

interface ReaderProps {
  availableCourses: Course[];
  historical?: boolean;
  selection: ReadingSelection;
  fontSize: number;
  onChange: (selection: ReadingSelection) => void;
}

function ReadingBody({
  content,
  fontSize,
}: {
  content: CurrentContent;
  fontSize: number;
}) {
  const [answerVisible, setAnswerVisible] = useState(false);
  const answerId = useId();

  return (
    <div className={styles.body}>
      <div className={styles.topic}>
        <span>{content.topic}</span>
        <span className={styles.topicTag}>{content.difficulty}</span>
      </div>
      <h1 className={styles.title}>{content.title}</h1>
      <div className={styles.question} style={{ fontSize }}>
        <Markdown>{content.content}</Markdown>
      </div>
      {content.kind === "questions" && (
        <section className={styles.answerArea} aria-label="参考答案">
          <label className={styles.answerToggle}>
            <input
              type="checkbox"
              checked={answerVisible}
              aria-controls={answerId}
              onChange={(event) => setAnswerVisible(event.target.checked)}
            />
            <span>显示参考答案</span>
          </label>
          <div
            id={answerId}
            hidden={!answerVisible}
            className={styles.answerBody}
            style={{ fontSize }}
          >
            <Markdown>{content.answer}</Markdown>
            <div className={styles.answerLabel}>讲解要点</div>
            <Markdown>{content.explanation}</Markdown>
          </div>
        </section>
      )}
    </div>
  );
}

export function Reader({
  selection,
  fontSize,
  onChange,
  availableCourses,
  historical,
}: ReaderProps) {
  const course = getCourse(
    selection.courseId,
    selection.version,
    availableCourses,
  );
  const content = getCurrentContent(selection, availableCourses);
  const isTextbook = selection.kind === "textbooks";
  const selectorId = useId();
  const book = course.textbooks.find((item) => item.id === selection.itemId);
  const index = isTextbook
    ? selection.chapterIndex
    : course.questions.findIndex((item) => item.id === selection.itemId);
  const count = isTextbook
    ? (book?.chapters.length ?? 0)
    : course.questions.length;
  const topics = [
    ...new Set(course.questions.map((question) => question.topic)),
  ];

  function navigate(offset: number) {
    const next = index + offset;
    if (next < 0 || next >= count) return;
    if (isTextbook) onChange({ ...selection, chapterIndex: next });
    else
      onChange({
        ...selection,
        itemId: course.questions[next]!.id,
        chapterIndex: 0,
      });
  }

  return (
    <section
      className={styles.reader}
      aria-label={isTextbook ? "教材阅读栏" : "题目阅读栏"}
    >
      <header className={styles.toolbar}>
        {historical && (
          <span className={styles.historyNote}>正在阅读历史版本</span>
        )}
        <label className={styles.selectLabel} htmlFor={selectorId}>
          {isTextbook ? "教材选择" : "题目选择"}
        </label>
        <select
          className={styles.selector}
          id={selectorId}
          value={selection.itemId}
          onChange={(event) =>
            onChange({
              ...selection,
              itemId: event.target.value,
              chapterIndex: 0,
            })
          }
        >
          {isTextbook
            ? course.textbooks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))
            : topics.map((topic) => (
                <optgroup key={topic} label={topic}>
                  {course.questions
                    .filter((question) => question.topic === topic)
                    .map((question) => (
                      <option key={question.id} value={question.id}>
                        {question.id} {question.title}
                      </option>
                    ))}
                </optgroup>
              ))}
        </select>
      </header>
      {/* 内容变化时重新创建正文，参考答案自动收起，阅读滚动位置回到顶部。 */}
      <ReadingBody
        key={`${course.id}:${course.version}:${content.kind}:${content.id}`}
        content={content}
        fontSize={fontSize}
      />
      <footer className={styles.navigation}>
        <button
          type="button"
          className={styles.navigationButton}
          disabled={index <= 0}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft aria-hidden="true" />
          <span>{isTextbook ? "上一节" : "上一题"}</span>
        </button>
        <span
          className={styles.position}
          aria-label={`第 ${index + 1} ${isTextbook ? "节" : "题"}，共 ${count} ${isTextbook ? "节" : "题"}`}
        >
          {index + 1} / {count}
        </span>
        <button
          type="button"
          className={styles.navigationButton}
          disabled={index >= count - 1}
          onClick={() => navigate(1)}
        >
          <span>{isTextbook ? "下一节" : "下一题"}</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
