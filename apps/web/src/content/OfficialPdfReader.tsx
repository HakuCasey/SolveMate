import { useCallback, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type {
  ReadingSelection,
  Textbook,
  LearningLocation,
} from "@solvemate/contracts";
import { PdfPage } from "../materials/PdfPage";
import { PdfControls } from "../materials/PdfControls";
import {
  readingDocumentKey,
  type ReadingPositionState,
  type ReadingScroll,
} from "../reading/state";
import { pdfPageLabel } from "../reading/text-selection";
import { readingKey, makeReadingReference } from "../reading/reference";
import styles from "../materials/MaterialReader.module.css";

export function OfficialPdfReader({
  book,
  selection,
  load,
  onChange,
  onBack,
  position,
  onPageScroll,
  continuous,
  onContinuousChange,
  zoom,
  onZoomChange,
  relatedContent,
  historical,
  removed,
}: {
  book: Textbook;
  selection: ReadingSelection;
  load: (
    selection: ReadingSelection,
    retry?: boolean,
  ) => Promise<{ blob: Blob; warning: string }>;
  onChange: (selection: ReadingSelection) => void;
  onBack: () => void;
  position: ReadingPositionState;
  onPageScroll: (location: LearningLocation, scroll: ReadingScroll) => void;
  continuous: boolean;
  onContinuousChange: (continuous: boolean) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  relatedContent?: ReactNode;
  historical?: boolean;
  removed?: boolean;
}) {
  const { courseId, version, itemId } = selection;
  // 加载只依赖固定资料版本；翻页不重新解包或读取文件。
  const loadPdf = useCallback(
    (retry: boolean) =>
      load(
        { courseId, version, itemId, kind: "textbooks", pageNumber: 1 },
        retry,
      ),
    [load, courseId, version, itemId],
  );
  const pdf = book.pdf!;
  const pageNumber = selection.pageNumber!;
  const location = (pageNumber: number) => ({
    courseId,
    version,
    itemId,
    kind: "textbooks" as const,
    pageNumber,
  });
  return (
    <section
      className={styles.reader}
      aria-label="学习资料阅读栏"
      data-study-area="reading"
    >
      <header className={styles.toolbar}>
        <button
          className={styles.back}
          type="button"
          aria-label="返回学习资料列表"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
          学习资料
        </button>
        <span className={styles.documentTitle} title={book.title}>
          {book.title}
        </span>
        {relatedContent}
      </header>
      {(removed || historical) && (
        <p className={styles.warning} role="status">
          {removed
            ? "该资料已从资料库删除，当前显示历史内容。"
            : "正在阅读历史版本"}
        </p>
      )}
      <PdfPage
        documentKey={readingDocumentKey(selection)}
        positionKey={readingKey(selection)}
        pageNumber={pageNumber}
        load={loadPdf}
        zoom={zoom}
        position={position}
        continuous={continuous}
        onPageChange={(pageNumber) => onChange(location(pageNumber))}
        onPageScroll={(pageNumber, scroll) =>
          onPageScroll(location(pageNumber), scroll)
        }
        onSelection={({
          text,
          pageNumber: selectedPage = pageNumber,
          endPageNumber,
        }) =>
          makeReadingReference(
            location(selectedPage),
            {
              topic: book.title,
              title: pdfPageLabel(selectedPage, endPageNumber),
              content: text,
            },
            text,
            true,
          )
        }
      />
      <PdfControls
        pageNumber={pageNumber}
        pageCount={pdf.pages.length}
        continuous={continuous}
        onContinuousChange={onContinuousChange}
        onPageChange={(pageNumber) => onChange(location(pageNumber))}
        zoom={zoom}
        onZoomChange={onZoomChange}
      />
    </section>
  );
}
