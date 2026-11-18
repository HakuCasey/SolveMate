import { QuestionReader } from "./QuestionReader";
import { ResourceUnavailable } from "../refresh/ResourceUnavailable";
import { dataRefresh } from "../refresh/coordinator";
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { ArrowLeft, FileText } from "lucide-react";
import type {
  Material,
  MaterialLocation,
  LearningLocation,
} from "@solvemate/contracts";
import type { PersonalMaterials } from "./useMaterials";
import { makeMaterialReference } from "./reference";
import type { ReadingPositionState, ReadingScroll } from "../reading/state";
import { pdfPageLabel, type SelectedText } from "../reading/text-selection";
import { PdfPage } from "./PdfPage";
import { PdfControls } from "./PdfControls";
import { materialApi, locationKey } from "./api";
import { readingDocumentKey } from "../reading/state";
import styles from "./MaterialReader.module.css";

export function MaterialReader({
  library,
  location,
  onChange,
  onBack,
  onPageScroll,
  continuous,
  onContinuousChange,
  position,
  onPositionChange,
  zoom,
  onZoomChange,
  relatedContent,
  header,
}: {
  relatedContent?: ReactNode;
  header?: ReactNode;
  library: PersonalMaterials;
  location: MaterialLocation | null;
  onBack: () => void;
  onChange: (location: MaterialLocation) => void;
  onPageScroll: (location: LearningLocation, scroll: ReadingScroll) => void;
  continuous: boolean;
  onContinuousChange: (continuous: boolean) => void;
  position: ReadingPositionState;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const materialId = location?.materialId ?? "";
  const contentVersion = location?.contentVersion ?? "";
  const loadPdf = useCallback(
    (retry: boolean) =>
      materialApi.reader({ materialId, contentVersion }, retry),
    [materialId, contentVersion],
  );
  const current = library.items.find(
    (item) => item.id === location?.materialId,
  );
  const [historical, setHistorical] = useState<Material | null>(null);
  const [versionError, setVersionError] = useState("");
  useEffect(() => {
    let alive = true;
    if (current && current.currentVersion !== contentVersion) {
      void materialApi
        .version(materialId, contentVersion)
        .then((record) => {
          if (alive) {
            setHistorical(record);
            setVersionError("");
          }
        })
        .catch((error: unknown) => {
          if (alive)
            setVersionError(
              error instanceof Error ? error.message : "版本读取失败。",
            );
        });
    }
    return () => {
      alive = false;
    };
  }, [materialId, contentVersion, current]);
  const selected =
    current?.currentVersion === contentVersion
      ? current
      : historical?.id === materialId &&
          historical.version.contentVersion === contentVersion
        ? historical
        : undefined;
  const ready =
    selected?.version.status === "ready" &&
    selected.availability?.readerAvailable !== false;
  const pageCount = selected?.version.pageCount ?? 1;
  function quote(selection: SelectedText) {
    if (!selected || !location)
      throw new Error("资料不可用，请重新打开后再选择内容。");
    const page = selection.pageNumber ?? location.pageNumber!;
    const reference = makeMaterialReference(
      selected,
      { ...location, pageNumber: page },
      selection.text,
      "selection",
    );
    reference.title = `${selected.title} · ${pdfPageLabel(page, selection.endPageNumber)}`;
    return reference;
  }

  if (selected?.kind === "questions" && location)
    return (
      <QuestionReader
        material={selected}
        location={location}
        onChange={onChange}
        onBack={onBack}
        position={position}
        onPositionChange={onPositionChange}
        header={header}
        relatedContent={relatedContent}
      />
    );

  return (
    <section
      className={styles.reader}
      aria-label="学习资料阅读栏"
      data-study-area="reading"
    >
      {header ?? (
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
          <span className={styles.documentTitle} title={selected?.title}>
            {selected?.title ?? "资料不可用"}
          </span>
          {relatedContent}
        </header>
      )}
      {!selected ? (
        <ResourceUnavailable
          message={
            versionError ||
            library.error ||
            "资料不在当前列表中，请重新读取或返回列表。"
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
              重新读取
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
            {selected.deletedAt != null && (
              <p role="status">该资料已从资料库删除，当前显示历史内容。</p>
            )}
            {selected.currentVersion !== contentVersion && (
              <p role="status">正在阅读历史版本</p>
            )}
            {selected.availability?.error && (
              <p role="alert">{selected.availability.error}</p>
            )}
            <PdfPage
              documentKey={readingDocumentKey(location)}
              positionKey={locationKey(location)}
              pageNumber={location.pageNumber!}
              load={loadPdf}
              zoom={zoom}
              onSelection={quote}
              position={position}
              continuous={continuous}
              onPageChange={(pageNumber) =>
                onChange({ ...location, pageNumber })
              }
              onPageScroll={(pageNumber, scroll) =>
                onPageScroll({ ...location, pageNumber }, scroll)
              }
            />
            <PdfControls
              pageNumber={location.pageNumber!}
              pageCount={pageCount}
              continuous={continuous}
              onContinuousChange={onContinuousChange}
              onPageChange={(pageNumber) =>
                onChange({ ...location, pageNumber })
              }
              zoom={zoom}
              onZoomChange={onZoomChange}
            />
          </>
        )
      )}
    </section>
  );
}
