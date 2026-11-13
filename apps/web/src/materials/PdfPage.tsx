import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AnnotationEditorType,
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  ScrollMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { useReadingSelection } from "../reading/useReadingSelection";
import type { ReadingReference } from "@solvemate/contracts";
import type { SelectedText } from "../reading/text-selection";
import type { ReadingPositionState, ReadingScroll } from "../reading/state";
import { WheelPaging } from "./wheel-paging";
import { logError } from "../logger";
import styles from "./MaterialReader.module.css";
GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  onAddReference: (reference: ReadingReference) => void;
  documentKey: string;
  positionKey: string;
  pageNumber: number;
  load: (retry: boolean) => Promise<{ blob: Blob; warning: string }>;
  zoom: number;
  continuous: boolean;
  onPageChange: (pageNumber: number) => void;
  onPageScroll: (pageNumber: number, scroll: ReadingScroll) => void;
  onSelection: (selection: SelectedText) => ReadingReference;
  position: ReadingPositionState;
}

/** PDF.js 管理多页布局、文字层和渲染缓存；应用仅保存位置及阅读模式。 */
export function PdfPage(props: Props) {
  const {
    documentKey,
    positionKey,
    pageNumber,
    load,
    zoom,
    continuous,
    onSelection,
    onAddReference,
  } = props;
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const apply = useRef<(() => Promise<void>) | null>(null);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const container = viewport.current,
      element = surface.current;
    if (!container || !element) return;
    const lifetime = new AbortController();
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    // 已安装版本支持 abortSignal，用于同时释放观察器与页面事件。
    const options = {
      container,
      viewer: element,
      eventBus,
      linkService,
      abortSignal: lifetime.signal,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      enableAutoLinking: false,
    };
    const viewer = new PDFViewer(options);
    linkService.setViewer(viewer);
    let task: ReturnType<typeof getDocument> | undefined;
    let initialized = false,
      available = false,
      restoring = false;
    let reportedPage = latest.current.pageNumber;
    let revision = 0;
    let pendingBottom: number | null = null;
    let applied = { width: 0, zoom: 0, continuous: false };
    const wheel = new WheelPaging();
    setError("");
    setWarning("");
    setLoading(true);
    setReady(false);

    function pageTop(page: number) {
      const div = viewer.getPageView(page - 1)?.div as
        HTMLDivElement | undefined;
      return div
        ? div.getBoundingClientRect().top -
            container!.getBoundingClientRect().top +
            container!.scrollTop
        : 0;
    }
    function capture(page = reportedPage) {
      if (!available || restoring || lifetime.signal.aborted) return;
      latest.current.onPageScroll(page, {
        top: Math.max(
          0,
          (container!.scrollTop - pageTop(page)) / latest.current.zoom,
        ),
        left: container!.scrollLeft / latest.current.zoom,
      });
    }
    async function applyView(force = false) {
      if (!initialized || lifetime.signal.aborted) return;
      const state = latest.current;
      const width = container!.clientWidth;
      if (
        !force &&
        reportedPage === state.pageNumber &&
        applied.width === width &&
        applied.zoom === state.zoom &&
        applied.continuous === state.continuous
      )
        return;
      const ticket = ++revision;
      restoring = true;
      if (state.pageNumber < 1 || state.pageNumber > viewer.pagesCount)
        throw new Error("当前页码超出 PDF 范围，请重新打开资料。");
      const page = viewer.getPageView(state.pageNumber - 1);
      if (!page.pdfPage) {
        const pdfPage = await viewer.pdfDocument!.getPage(state.pageNumber);
        if (lifetime.signal.aborted || ticket !== revision) return;
        page.setPdfPage(pdfPage);
      }
      viewer.scrollMode = state.continuous
        ? ScrollMode.VERTICAL
        : ScrollMode.PAGE;
      viewer.currentPageNumber = state.pageNumber;
      viewer.currentScaleValue = "page-width";
      viewer.currentScale *= state.zoom;
      viewer.scrollPageIntoView({ pageNumber: state.pageNumber });
      const top = pageTop(state.pageNumber);
      container!.scrollTo({
        top: Math.max(
          0,
          Math.min(
            !state.continuous && pendingBottom === state.pageNumber
              ? container!.scrollHeight - container!.clientHeight
              : top + state.position.scroll.top * state.zoom,
            container!.scrollHeight - container!.clientHeight,
          ),
        ),
        left: state.position.scroll.left * state.zoom,
        behavior: "instant",
      });
      reportedPage = state.pageNumber;
      pendingBottom = null;
      applied = { width, zoom: state.zoom, continuous: state.continuous };
      viewer.update();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          if (!lifetime.signal.aborted && ticket === revision)
            restoring = false;
          resolve();
        }),
      );
    }
    function fail(failure: unknown) {
      if (lifetime.signal.aborted) return;
      setError(
        failure instanceof Error ? failure.message : "PDF 显示失败，请重试。",
      );
      setLoading(false);
      setReady(false);
      available = false;
    }
    apply.current = () => applyView().catch(fail);
    eventBus.on(
      "updateviewarea",
      ({ location }: { location?: { pageNumber: number } }) => {
        if (!available || restoring || !location) return;
        // 使用视口顶部所在页作为阅读位置，页内偏移始终相对该页保存。
        reportedPage = location.pageNumber;
        capture(reportedPage);
        if (latest.current.pageNumber !== reportedPage)
          latest.current.onPageChange(reportedPage);
      },
      { signal: lifetime.signal },
    );
    eventBus.on(
      "pagerendered",
      ({ error: failure }: { error?: Error }) => {
        if (failure) fail(new Error("此页显示失败，请重试显示。"));
      },
      { signal: lifetime.signal },
    );
    const firstLayout = new Promise<void>((resolve, reject) => {
      eventBus.on(
        "pagesinit",
        () => {
          initialized = true;
          void applyView(true).then(resolve, reject);
        },
        { signal: lifetime.signal },
      );
    });
    const resize = new ResizeObserver(() => {
      if (!initialized) return;
      if (container.clientWidth !== applied.width) void applyView().catch(fail);
      else viewer.update();
    });
    resize.observe(container);

    function jump(page: number, previousBottom = false) {
      if (!available || page < 1 || page > viewer.pagesCount) return;
      capture();
      restoring = true;
      pendingBottom = previousBottom ? page : null;
      const height = viewer.getPageView(page - 1)?.height ?? 0;
      latest.current.onPageScroll(page, {
        top: previousBottom
          ? Math.max(0, height - container!.clientHeight) / latest.current.zoom
          : 0,
        left: container!.scrollLeft / latest.current.zoom,
      });
      latest.current.onPageChange(page);
    }
    container.addEventListener(
      "wheel",
      (event) => {
        if (latest.current.continuous || !available) return;
        const result = wheel.handle(
          event,
          container,
          latest.current.pageNumber,
          viewer.pagesCount,
        );
        if (result.consume) event.preventDefault();
        if (result.page !== latest.current.pageNumber)
          jump(result.page, result.page < latest.current.pageNumber);
      },
      { passive: false, signal: lifetime.signal },
    );
    container.addEventListener(
      "keydown",
      (event) => {
        if (
          latest.current.continuous ||
          !available ||
          (event.target as HTMLElement).closest(
            "input, textarea, [contenteditable=true]",
          )
        )
          return;
        const direction = ["PageDown", "ArrowDown"].includes(event.key)
          ? 1
          : ["PageUp", "ArrowUp"].includes(event.key)
            ? -1
            : 0;
        const edge =
          direction > 0
            ? container.scrollTop + container.clientHeight >=
              container.scrollHeight - 2
            : container.scrollTop <= 2;
        if (!direction || !edge || event.repeat) return;
        const next = latest.current.pageNumber + direction;
        if (next < 1 || next > viewer.pagesCount) return;
        event.preventDefault();
        jump(next, direction < 0);
      },
      { signal: lifetime.signal },
    );
    let touch: { y: number; at: number; top: boolean; bottom: boolean } | null =
      null;
    container.addEventListener(
      "touchstart",
      (event) => {
        const finger = event.touches.length === 1 ? event.touches[0] : null;
        touch =
          finger && !latest.current.continuous
            ? {
                y: finger.clientY,
                at: performance.now(),
                top: container.scrollTop <= 2,
                bottom:
                  container.scrollTop + container.clientHeight >=
                  container.scrollHeight - 2,
              }
            : null;
      },
      { passive: true, signal: lifetime.signal },
    );
    container.addEventListener(
      "touchend",
      (event) => {
        const start = touch,
          finger = event.changedTouches[0];
        touch = null;
        if (
          !start ||
          !finger ||
          latest.current.continuous ||
          performance.now() - start.at > 600 ||
          !window.getSelection()?.isCollapsed
        )
          return;
        const delta = start.y - finger.clientY;
        if (delta > 50 && start.bottom) jump(latest.current.pageNumber + 1);
        else if (delta < -50 && start.top)
          jump(latest.current.pageNumber - 1, true);
      },
      { passive: true, signal: lifetime.signal },
    );

    void (async () => {
      const result = await load(attempt > 0);
      if (lifetime.signal.aborted) return;
      setWarning(result.warning);
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      if (lifetime.signal.aborted) return;
      task = getDocument({
        data: bytes,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
        enableXfa: false,
      });
      const pdf = await task.promise;
      if (lifetime.signal.aborted) return;
      viewer.setDocument(pdf);
      linkService.setDocument(pdf);
      await firstLayout;
      // 页面尺寸就绪后恢复位置；只按需绘制可见页，不一次生成整本书的画布。
      await viewer.pagesPromise;
      if (lifetime.signal.aborted) return;
      await applyView(true);
      if (lifetime.signal.aborted) return;
      available = true;
      setReady(true);
      setLoading(false);
      capture();
    })().catch(fail);
    return () => {
      capture();
      lifetime.abort();
      resize.disconnect();
      apply.current = null;
      viewer.setDocument(null);
      void task
        ?.destroy()
        .catch((failure) =>
          logError("Failed to release the PDF reader.", failure),
        );
    };
  }, [documentKey, load, attempt]);
  useEffect(() => {
    void apply.current?.();
  }, [pageNumber, zoom, continuous]);
  const selection = useReadingSelection(
    surface,
    positionKey,
    ready,
    (selection) => onAddReference(onSelection(selection)),
  );
  return (
    <>
      {warning && (
        <p className={styles.warning} role="status">
          {warning}
        </p>
      )}
      <div className={styles.pdfHost}>
        <div
          ref={viewport}
          className={styles.pdfViewport}
          aria-label={`资料第 ${pageNumber} 页`}
          tabIndex={0}
        >
          <div
            ref={surface}
            className={`pdfViewer ${styles.pdfPages}`}
            onMouseUp={selection.onMouseUp}
            onKeyUp={selection.onKeyUp}
            onTouchEnd={selection.onTouchEnd}
          />
        </div>
        {(loading || error) && (
          <div className={styles.pdfStatus} role={error ? "alert" : "status"}>
            {error || "正在打开 PDF…"}
            {error && (
              <button onClick={() => setAttempt((value) => value + 1)}>
                重试显示
              </button>
            )}
          </div>
        )}
        {selection.overlay}
      </div>
    </>
  );
}
