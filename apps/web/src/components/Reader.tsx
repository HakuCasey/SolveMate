import { ResourceUnavailable } from "../refresh/ResourceUnavailable";
import {
  lazy,
  Suspense,
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
  LearningLocation,
} from "@solvemate/contracts";
import { getCourse, getCurrentContent } from "../data/catalog";
import {
  makeReadingReference,
  readingKey,
  UNSUPPORTED_READING_REFERENCE,
} from "../reading/reference";
import type { ReadingPositionState, ReadingScroll } from "../reading/state";
import { useReadingScroll } from "../reading/useReadingScroll";
import { useReadingSelection } from "../reading/useReadingSelection";
import { Markdown } from "./Markdown";
import styles from "./Reader.module.css";

const OfficialPdfReader = lazy(() =>
  import("../content/OfficialPdfReader").then((module) => ({
    default: module.OfficialPdfReader,
  })),
);

interface ReaderProps {
  loadPdf: (
    selection: ReadingSelection,
    retry?: boolean,
  ) => Promise<{ blob: Blob; warning: string }>;
  zoom: number;
  continuous: boolean;
  onContinuousChange: (continuous: boolean) => void;
  onPageScroll: (location: LearningLocation, scroll: ReadingScroll) => void;
  onZoomChange: (zoom: number) => void;
  relatedContent?: ReactNode;
  availableCourses: Course[];
  historical?: boolean;
  removed?: boolean;
  selection: ReadingSelection;
  fontSize: number;
  onChange: (selection: ReadingSelection) => void;
  onBack: () => void;
  position: ReadingPositionState;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
}

function QuestionBody({
  content,
  fontSize,
  selection,
  position,
  onPositionChange,
}: {
  content: CurrentContent;
  fontSize: number;
  selection: ReadingSelection;
  position: ReadingPositionState;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
}) {
  const { answerVisible } = position;
  const answerId = useId();
  const source = useRef<HTMLDivElement>(null);
  const key = readingKey(selection);
  useReadingScroll(source, key, position.scroll, onPositionChange);
  const selected = useReadingSelection(source, key, true, (value) =>
    makeReadingReference(selection, content, value.text, true),
  );

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
      {selected.overlay}
    </div>
  );
}

export function Reader(props: ReaderProps) {
  try {
    getCurrentContent(props.selection, props.availableCourses);
  } catch (error) {
    return (
      <ResourceUnavailable
        message={
          error instanceof Error &&
          error.message === UNSUPPORTED_READING_REFERENCE
            ? UNSUPPORTED_READING_REFERENCE
            : "对应的内容或版本暂不可用，原阅读位置、对话和草稿仍保留，请恢复文件或重新下载后刷新。"
        }
        onBack={props.onBack}
      />
    );
  }
  const course = getCourse(
    props.selection.courseId,
    props.selection.version,
    props.availableCourses,
  );
  const book =
    props.selection.kind === "textbooks"
      ? course.textbooks.find((item) => item.id === props.selection.itemId)
      : undefined;
  if (props.selection.kind === "textbooks") {
    if (!book?.pdf)
      return (
        <ResourceUnavailable
          message="该版本没有可用的 PDF，原有记录已保留，请检查内容更新。"
          onBack={props.onBack}
        />
      );
    return (
      <Suspense fallback={<p role="status">正在打开资料阅读器…</p>}>
        <OfficialPdfReader {...props} book={book} load={props.loadPdf} />
      </Suspense>
    );
  }
  return <QuestionReader {...props} />;
}

function QuestionReader({
  selection,
  fontSize,
  onChange,
  availableCourses,
  historical,
  removed,
  onBack,
  position,
  onPositionChange,
  relatedContent,
}: ReaderProps) {
  const course = getCourse(
    selection.courseId,
    selection.version,
    availableCourses,
  );
  const content = getCurrentContent(selection, availableCourses);
  const index = course.questions.findIndex(
    (item) => item.id === selection.itemId,
  );
  const count = course.questions.length;
  function navigate(offset: number) {
    const next = index + offset;
    if (next < 0 || next >= count) return;
    onChange({
      ...selection,
      itemId: course.questions[next]!.id,
    });
  }

  return (
    <section
      className={styles.reader}
      aria-label="题目阅读栏"
      data-study-area="reading"
    >
      <header className={styles.toolbar}>
        {(historical || removed) && (
          <span className={styles.historyNote}>
            {removed
              ? "该资料已从资料库删除，当前显示历史内容。"
              : "正在阅读历史版本"}
          </span>
        )}
        <div className={styles.titleRow}>
          <button
            type="button"
            className={styles.back}
            aria-label="返回题目列表"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
            题目
          </button>
          <span className={styles.documentTitle} title={selection.itemId}>
            {selection.itemId}
          </span>
          {relatedContent}
        </div>
      </header>
      {/* 按内容重建正文，显示状态和滚动位置由应用层的同一份阅读记录恢复。 */}
      <QuestionBody
        key={`${course.id}:${course.version}:${content.kind}:${content.id}`}
        content={content}
        fontSize={fontSize}
        selection={selection}
        position={position}
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
          <span>上一题</span>
        </button>
        <span
          className={styles.position}
          aria-label={`第 ${index + 1} 题，共 ${count} 题`}
        >
          {index + 1} / {count}
        </span>
        <button
          type="button"
          className={styles.navigationButton}
          disabled={index >= count - 1}
          onClick={() => navigate(1)}
        >
          <span>下一题</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
