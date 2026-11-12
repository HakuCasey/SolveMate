import { ResourceUnavailable } from "../refresh/ResourceUnavailable";
import {
  useId,
  useRef,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type {
  Course,
  CurrentContent,
  ReadingSelection,
} from "@solvemate/contracts";
import { getCourse, getCurrentContent } from "../data/catalog";
import { makeReadingReference, readingKey } from "../reading/reference";
import type { ReadingPositionState } from "../reading/state";
import { useReadingScroll } from "../reading/useReadingScroll";
import { useReadingSelection } from "../reading/useReadingSelection";
import { Markdown } from "./Markdown";
import styles from "./Reader.module.css";

interface ReaderProps {
  relatedContent?: ReactNode;
  availableCourses: Course[];
  historical?: boolean;
  removed?: boolean;
  selection: ReadingSelection;
  fontSize: number;
  onChange: (selection: ReadingSelection) => void;
  onBack: () => void;
  position: ReadingPositionState;
  onAddReference: (
    reference: import("@solvemate/contracts").ReadingReference,
  ) => void;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
}

function ReadingBody({
  content,
  fontSize,
  selection,
  position,
  onAddReference,
  onPositionChange,
}: {
  content: CurrentContent;
  fontSize: number;
  selection: ReadingSelection;
  position: ReadingPositionState;
  onAddReference: (
    reference: import("@solvemate/contracts").ReadingReference,
  ) => void;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
}) {
  const { answerVisible } = position;
  const answerId = useId();
  const source = useRef<HTMLDivElement>(null);
  const key = readingKey(selection);
  useReadingScroll(source, key, position.scroll, onPositionChange);
  const selected = useReadingSelection(source, key, true, (value) => {
    onAddReference(makeReadingReference(selection, content, value.text, true));
  });

  return (
    <div
      className={styles.body}
      ref={source}
      onMouseUp={selected.onMouseUp}
      onKeyUp={selected.onKeyUp}
      onTouchEnd={selected.onTouchEnd}
    >
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
              onChange={(event) => {
                const answerVisible = event.target.checked;
                onPositionChange((previous) => ({
                  ...previous,
                  answerVisible,
                }));
              }}
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
      {selected.overlay}
    </div>
  );
}

export function Reader(props: ReaderProps) {
  try {
    getCurrentContent(props.selection, props.availableCourses);
  } catch {
    return (
      <ResourceUnavailable
        message="对应的内容或版本暂不可用，原阅读位置、对话和草稿仍保留，请恢复文件或重新下载后刷新。"
        onBack={props.onBack}
      />
    );
  }
  return <AvailableReader {...props} />;
}

function AvailableReader({
  selection,
  fontSize,
  onChange,
  availableCourses,
  historical,
  removed,
  onBack,
  position,
  onAddReference,
  onPositionChange,
  relatedContent,
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
      aria-label={isTextbook ? "学习资料阅读栏" : "题目阅读栏"}
    >
      <header className={styles.toolbar}>
        {(historical || removed) && (
          <span className={styles.historyNote}>
            {removed
              ? "该资料已从资料库删除，当前显示历史内容。"
              : "正在阅读历史版本"}
          </span>
        )}
        <button
          type="button"
          className={styles.back}
          aria-label={isTextbook ? "返回学习资料列表" : "返回题目列表"}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
          {isTextbook ? "学习资料" : "题目"}
        </button>
        <span className={styles.documentTitle}>
          {isTextbook ? book?.title : selection.itemId}
        </span>
        {isTextbook && (
          <>
            <label className={styles.selectLabel} htmlFor={selectorId}>
              章节
            </label>
            <select
              className={styles.selector}
              id={selectorId}
              value={selection.chapterIndex}
              onChange={(event) =>
                onChange({
                  ...selection,
                  chapterIndex: Number(event.target.value),
                })
              }
            >
              {book?.chapters.map((chapter, index) => (
                <option value={index} key={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </>
        )}
        {relatedContent}
      </header>
      {/* 按内容重建正文，显示状态和滚动位置由应用层的同一份阅读记录恢复。 */}
      <ReadingBody
        key={`${course.id}:${course.version}:${content.kind}:${content.id}`}
        content={content}
        fontSize={fontSize}
        selection={selection}
        position={position}
        onAddReference={onAddReference}
        onPositionChange={onPositionChange}
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
