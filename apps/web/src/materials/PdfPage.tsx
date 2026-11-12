import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { MaterialLocation } from "@solvemate/contracts";
import { materialApi } from "./api";
import { useReadingSelection } from "../reading/useReadingSelection";
import type { SelectedText } from "../reading/text-selection";
import type { ReadingPositionState } from "../reading/state";
import { useReadingScroll } from "../reading/useReadingScroll";
import { locationKey } from "./api";
import styles from "./MaterialReader.module.css";
GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPage({
  location,
  zoom,
  onSelection,
  position,
  onPositionChange,
}: {
  location: MaterialLocation;
  zoom: number;
  onSelection: (selection: SelectedText) => void;
  position: ReadingPositionState;
  onPositionChange: Dispatch<SetStateAction<ReadingPositionState>>;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(600);
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [renderedRevision, setRenderedRevision] = useState("");
  const key = locationKey(location);
  const revision = JSON.stringify([key, width, zoom, attempt]);
  const ready = !loading && !error && renderedRevision === revision;
  useReadingScroll(
    viewport,
    key,
    position.scroll,
    onPositionChange,
    ready,
    zoom,
  );
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width - 32)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    setDocument(null);
    surface.current?.replaceChildren();
    setError("");
    setWarning("");
    setLoading(true);
    void materialApi
      .reader(
        {
          materialId: location.materialId,
          contentVersion: location.contentVersion,
        },
        attempt > 0,
      )
      .then(async (result) => {
        if (!alive) return;
        setWarning(result.warning);
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        if (!alive) return;
        loadingTask = getDocument({
          data: bytes,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          enableXfa: false,
        });
        const pdf = await loadingTask.promise;
        if (alive) setDocument(pdf);
      })
      .catch((failure) => {
        if (alive) {
          setError(
            failure instanceof Error ? failure.message : "无法打开阅读文件。",
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      void loadingTask?.destroy();
    };
    // 翻页和缩放复用同一个 PDF，避免重复载入长篇教材。
  }, [location.materialId, location.contentVersion, attempt]);
  useEffect(() => {
    const node = surface.current;
    if (!document || !node) return;
    let alive = true;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let textLayer: TextLayer | undefined;
    setError("");
    setLoading(true);
    node.replaceChildren();
    void document
      .getPage(location.pageNumber)
      .then(async (page) => {
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        const view = page.getViewport({ scale: (width / base.width) * zoom });
        const canvas = window.document.createElement("canvas");
        const text = window.document.createElement("div");
        text.className = "textLayer";
        node.style.width = `${view.width}px`;
        node.style.height = `${view.height}px`;
        node.style.setProperty("--scale-factor", String(view.scale));
        node.style.setProperty("--total-scale-factor", String(view.scale));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(view.width * pixelRatio);
        canvas.height = Math.ceil(view.height * pixelRatio);
        canvas.style.width = `${view.width}px`;
        canvas.style.height = `${view.height}px`;
        node.append(canvas, text);
        render = page.render({
          canvas,
          viewport: view,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: text,
          viewport: view,
        });
        await Promise.all([render.promise, textLayer.render()]);
        if (alive) {
          setRenderedRevision(revision);
          setLoading(false);
        }
      })
      .catch((failure) => {
        if (alive && failure?.name !== "RenderingCancelledException") {
          setError("此页显示失败，请重试或重新打开资料。");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [
    document,
    location.materialId,
    location.contentVersion,
    location.pageNumber,
    width,
    zoom,
    attempt,
    revision,
  ]);
  const selection = useReadingSelection(surface, key, ready, onSelection);
  return (
    <div
      ref={viewport}
      className={styles.viewport}
      aria-label={`资料第 ${location.pageNumber} 页`}
    >
      {warning && (
        <p className={styles.warning} role="status">
          {warning}
        </p>
      )}
      {loading && (
        <p className={styles.pageStatus} role="status">
          正在显示第 {location.pageNumber} 页…
        </p>
      )}
      {error && (
        <div className={styles.pageStatus} role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((value) => value + 1)}>
            重试显示
          </button>
        </div>
      )}
      <div className={styles.pdfSheet}>
        <div
          ref={surface}
          className={styles.pdfSurface}
          onMouseUp={selection.onMouseUp}
          onKeyUp={selection.onKeyUp}
          onTouchEnd={selection.onTouchEnd}
        />
        {selection.overlay}
      </div>
    </div>
  );
}
