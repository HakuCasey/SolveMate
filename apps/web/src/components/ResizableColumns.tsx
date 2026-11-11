import { Children, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./ResizableColumns.module.css";

const DIVIDER_WIDTH = 8;
const MIN_LEFT_WIDTH = 280;
const MIN_RIGHT_WIDTH = 320;

function limits(width: number) {
  if (width === 0) return { min: 0, max: 1 };
  const available = width - DIVIDER_WIDTH;
  if (available < MIN_LEFT_WIDTH + MIN_RIGHT_WIDTH)
    return { min: 0.5, max: 0.5 };
  return {
    min: MIN_LEFT_WIDTH / available,
    max: 1 - MIN_RIGHT_WIDTH / available,
  };
}

interface ResizableColumnsProps {
  children: ReactNode;
  className: string;
  hidden: boolean;
  enabled: boolean;
  ratio: number;
  onRatioChange: (ratio: number) => void;
}

export function ResizableColumns({
  children,
  className,
  hidden,
  enabled,
  ratio,
  onRatioChange,
}: ResizableColumnsProps) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    offset: number;
    ratio: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const resizing = preview !== null;
  const primaryId = useId();
  const { min, max } = limits(width);
  const visibleRatio = Math.max(min, Math.min(max, preview ?? ratio));

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const body = document.body;
    const previousCursor = body.style.cursor;
    const previousSelect = body.style.userSelect;
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";
    function cancel() {
      drag.current = null;
      setPreview(null);
    }
    // 失焦或切换到上下布局时取消拖动，避免留下拖动光标或误保存比例。
    const media = window.matchMedia("(max-width: 800px)");
    window.addEventListener("blur", cancel);
    media.addEventListener("change", cancel);
    return () => {
      body.style.cursor = previousCursor;
      body.style.userSelect = previousSelect;
      window.removeEventListener("blur", cancel);
      media.removeEventListener("change", cancel);
    };
  }, [resizing]);

  function finish(save: boolean) {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    // 拖动期间只更新界面，松开后保存一次，避免逐像素写入学习记录。
    if (save && current && current.ratio !== ratio)
      onRatioChange(current.ratio);
  }

  const panes = Children.toArray(children);
  return (
    <div
      ref={container}
      className={`${className} ${enabled ? styles.resizable : ""}`}
      hidden={hidden}
      style={
        enabled
          ? {
              gridTemplateColumns: `minmax(0, ${visibleRatio}fr) ${DIVIDER_WIDTH}px minmax(0, ${1 - visibleRatio}fr)`,
            }
          : undefined
      }
    >
      {enabled ? (
        <>
          <div className={styles.pane} id={primaryId}>
            {panes[0]}
          </div>
          <div
            role="separator"
            tabIndex={0}
            aria-label="调整材料栏与会话栏宽度"
            aria-controls={primaryId}
            aria-orientation="vertical"
            aria-valuemin={Math.floor(min * 100)}
            aria-valuemax={Math.ceil(max * 100)}
            aria-valuenow={Math.round(visibleRatio * 100)}
            aria-valuetext={`左栏 ${Math.round(visibleRatio * 100)}%`}
            title="拖动调整宽度，双击恢复等宽；可用左右方向键调整"
            className={styles.divider}
            data-dragging={preview !== null || undefined}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              const rect = container.current!.getBoundingClientRect();
              drag.current = {
                pointerId: event.pointerId,
                offset:
                  event.clientX -
                  rect.left -
                  visibleRatio * (rect.width - DIVIDER_WIDTH) -
                  DIVIDER_WIDTH / 2,
                ratio: visibleRatio,
              };
              setPreview(visibleRatio);
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const rect = container.current!.getBoundingClientRect();
              const bounds = limits(rect.width);
              const next =
                (event.clientX -
                  rect.left -
                  DIVIDER_WIDTH / 2 -
                  current.offset) /
                (rect.width - DIVIDER_WIDTH);
              current.ratio = Math.max(bounds.min, Math.min(bounds.max, next));
              setPreview(current.ratio);
            }}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
            onLostPointerCapture={() => finish(false)}
            onDoubleClick={() => onRatioChange(0.5)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                finish(false);
                return;
              }
              if (drag.current || width <= DIVIDER_WIDTH) return;
              const step = (event.shiftKey ? 40 : 16) / (width - DIVIDER_WIDTH);
              const next = {
                ArrowLeft: visibleRatio - step,
                ArrowRight: visibleRatio + step,
                Home: min,
                End: max,
              }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              onRatioChange(Math.max(min, Math.min(max, next)));
            }}
          />
          <div className={styles.pane}>{panes[1]}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
