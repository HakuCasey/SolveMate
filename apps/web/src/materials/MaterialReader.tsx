import { ResourceUnavailable } from "../refresh/ResourceUnavailable";
import { dataRefresh } from "../refresh/coordinator";
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { MaterialLocation, ReadingReference } from "@solvemate/contracts";
import type { PersonalMaterials } from "./useMaterials";
import { makeMaterialReference } from "./reference";
import type { ReadingPositionState } from "../reading/state";
import type { SelectedText } from "../reading/text-selection";
import { PdfPage } from "./PdfPage";
import styles from "./MaterialReader.module.css";

export function MaterialReader({
  library,
  location,
  onChange,
  onBack,
  onPositionChange,
  position,
  zoom,
  onZoomChange,
  onAddReference,
  relatedContent,
}: {
  relatedContent?: ReactNode;
  onAddReference: (reference: ReadingReference) => void;
  library: PersonalMaterials;
  location: MaterialLocation | null;
  onBack: () => void;
  onChange: (location: MaterialLocation) => void;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
  position: ReadingPositionState;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const [pageInput, setPageInput] = useState(String(location?.pageNumber ?? 1));
  const selected = library.items.find(
    (item) => item.id === location?.materialId,
  );
  const ready =
    selected?.version.status === "ready" &&
    selected.availability?.readerAvailable !== false;
  const pageCount = selected?.version.pageCount ?? 1;
  useEffect(() => {
    setPageInput(String(location?.pageNumber ?? 1));
  }, [location?.pageNumber]);
  function go(page: number) {
    if (location && Number.isInteger(page) && page >= 1 && page <= pageCount) {
      if (page !== location.pageNumber)
        onChange({ ...location, pageNumber: page });
    } else setPageInput(String(location?.pageNumber ?? 1));
  }
  function quote(selection: SelectedText) {
    if (!selected || !location) return;
    onAddReference(
      makeMaterialReference(selected, location, selection.text, "selection"),
    );
  }

  return (
    <section className={styles.reader} aria-label="学习资料阅读栏">
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
        <span className={styles.documentTitle}>
          {selected?.title ?? "资料不可用"}
        </span>
        {relatedContent}
      </header>
      {!selected ? (
        <ResourceUnavailable
          message={
            library.error || "资料不在当前列表中，请刷新数据或返回列表。"
          }
          onBack={onBack}
        />
      ) : !ready ? (
        <div className={styles.empty}>
          <FileText aria-hidden="true" />
          <h2>{selected.title}</h2>
          <p role={selected.version.status === "failed" ? "alert" : "status"}>
            {selected.availability?.error ||
              selected.version.error ||
              (selected.version.mediaType === "application/pdf"
                ? "原件已保存，正在读取 PDF…"
                : "原件已保存，正在转换课件…")}
          </p>
          {selected.availability?.error && (
            <button
              onClick={() => void dataRefresh.refresh(undefined, false, true)}
            >
              刷新数据
            </button>
          )}
          {(selected.version.status === "failed" ||
            (selected.availability?.readerAvailable === false &&
              selected.availability?.originalAvailable)) && (
            <button onClick={() => void library.retry(selected.id)}>
              重试处理
            </button>
          )}
        </div>
      ) : (
        location && (
          <>
            {selected.availability?.error && (
              <p role="alert">{selected.availability.error}</p>
            )}
            <div className={styles.pageToolbar}>
              <span>
                {selected.version.mediaType === "application/pdf"
                  ? "PDF"
                  : "PPTX"}{" "}
                · {pageCount} 页
              </span>
              <button
                aria-label="缩小资料"
                disabled={zoom <= 0.5}
                onClick={() => onZoomChange(Math.max(0.5, zoom - 0.25))}
              >
                <ZoomOut aria-hidden="true" />
              </button>
              <button onClick={() => onZoomChange(1)} aria-label="适应栏宽">
                {Math.round(zoom * 100)}%
              </button>
              <button
                aria-label="放大资料"
                disabled={zoom >= 3}
                onClick={() => onZoomChange(Math.min(3, zoom + 0.25))}
              >
                <ZoomIn aria-hidden="true" />
              </button>
            </div>
            <PdfPage
              location={location}
              zoom={zoom}
              onSelection={quote}
              position={position}
              onPositionChange={onPositionChange}
            />
            <footer className={styles.navigation}>
              <button
                aria-label="上一页"
                disabled={location.pageNumber <= 1}
                onClick={() => go(location.pageNumber - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                上一页
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  go(Number(pageInput));
                }}
              >
                <input
                  aria-label="资料页码"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onBlur={() => go(Number(pageInput))}
                />
                <span>/ {pageCount}</span>
              </form>
              <button
                aria-label="下一页"
                disabled={location.pageNumber >= pageCount}
                onClick={() => go(location.pageNumber + 1)}
              >
                下一页
                <ChevronRight aria-hidden="true" />
              </button>
            </footer>
          </>
        )
      )}
    </section>
  );
}
