import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type {
  Material,
  MaterialLocation,
  Question,
} from "@solvemate/contracts";
import { materialApi, locationKey } from "./api";
import { makeMaterialReference } from "./reference";
import { Markdown } from "../components/Markdown";
import { useReadingSelection } from "../reading/useReadingSelection";
import { useReadingScroll } from "../reading/useReadingScroll";
import type { ReadingPositionState } from "../reading/state";
import styles from "../components/Reader.module.css";

/** 题目按内容格式显示，不区分资料来源。 */
export function QuestionReader({
  fontSize,
  material,
  location,
  onChange,
  onBack,
  position,
  onPositionChange,
  header,
  relatedContent,
}: {
  fontSize: number;
  material: Material;
  location: MaterialLocation;
  onChange: (location: MaterialLocation) => void;
  onBack: () => void;
  position: ReadingPositionState;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
  header?: ReactNode;
  relatedContent?: ReactNode;
}) {
  const [result, setResult] = useState<{
    key: string;
    items: Question[];
    error: string;
  } | null>(null);
  const key = `${location.materialId}/${location.contentVersion}`;
  useEffect(() => {
    let alive = true;
    void materialApi
      .questions({
        materialId: location.materialId,
        contentVersion: location.contentVersion,
      })
      .then((items) => {
        if (alive) setResult({ key, items, error: "" });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            items: [],
            error:
              error instanceof Error
                ? error.message
                : "题目读取失败，请重新打开。",
          });
      });
    return () => {
      alive = false;
    };
  }, [key, location.materialId, location.contentVersion]);
  const items = result?.key === key ? result.items : [];
  const index = items.findIndex((item) => item.id === location.questionId);
  const question = items[index];
  const body = useRef<HTMLDivElement>(null);
  const positionKey = locationKey(location);
  useReadingScroll(
    body,
    positionKey,
    position.scroll,
    onPositionChange,
    !!question,
  );
  const selected = useReadingSelection(body, positionKey, !!question, (value) =>
    makeMaterialReference(material, location, value.text, "selection"),
  );
  return (
    <section
      className={styles.reader}
      aria-label="题目阅读栏"
      data-study-area="reading"
    >
      {header ?? (
        <header className={styles.toolbar}>
          <button onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            题目
          </button>
          <strong>{material.title}</strong>
          {relatedContent}
        </header>
      )}
      {material.deletedAt != null && (
        <p role="status">该资料已从资料库删除，当前显示历史内容。</p>
      )}
      {question ? (
        <>
          <div
            className={styles.body}
            ref={body}
            onMouseUp={selected.onMouseUp}
            onKeyUp={selected.onKeyUp}
            onTouchEnd={selected.onTouchEnd}
          >
            <div className={styles.topic}>
              {question.topic} · {question.difficulty}
            </div>
            <h1 className={styles.title}>{question.title}</h1>
            <div className={styles.question} style={{ fontSize }}>
              <Markdown>{question.question}</Markdown>
            </div>
            <section className={styles.answerArea} aria-label="参考答案">
              <label className={styles.answerToggle}>
                <input
                  type="checkbox"
                  checked={position.answerVisible}
                  onChange={(event) =>
                    onPositionChange((previous) => ({
                      ...previous,
                      answerVisible: event.target.checked,
                    }))
                  }
                />
                显示参考答案
              </label>
              {position.answerVisible && (
                <div className={styles.answerBody} style={{ fontSize }}>
                  <Markdown>{question.answer}</Markdown>
                  <div className={styles.answerLabel}>讲解要点</div>
                  <Markdown>{question.explanation}</Markdown>
                </div>
              )}
            </section>
            {selected.overlay}
          </div>
          <footer className={styles.navigation}>
            <button
              className={styles.navigationButton}
              disabled={index <= 0}
              onClick={() =>
                onChange({ ...location, questionId: items[index - 1]!.id })
              }
            >
              <ChevronLeft />
              上一题
            </button>
            <span className={styles.position}>
              {index + 1} / {items.length}
            </span>
            <button
              className={styles.navigationButton}
              disabled={index >= items.length - 1}
              onClick={() =>
                onChange({ ...location, questionId: items[index + 1]!.id })
              }
            >
              下一题
              <ChevronRight />
            </button>
          </footer>
        </>
      ) : (
        <p role="status">
          {result?.key === key
            ? result.error || "当前版本中没有找到该题目。"
            : "正在读取题目…"}
        </p>
      )}
    </section>
  );
}
