import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";
import { captureSelectedText, type SelectedText } from "./text-selection";
import styles from "./SelectionAction.module.css";

/** 浏览器选区只用于临时选择；确认添加后才交给应用保存引用。 */
export function useReadingSelection(
  root: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean,
  onSelected: (selection: SelectedText) => void,
) {
  const [pending, setPending] = useState<{
    selection: SelectedText;
    left: number;
    top: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPending(null);
    setError("");
    const document = root.current?.ownerDocument;
    if (!document) return;
    const clear = () => {
      const selection = document!.getSelection();
      if (
        !root.current ||
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.getRangeAt(0).intersectsNode(root.current)
      ) {
        setPending(null);
        setError("");
      }
    };
    const dismiss = () => setPending(null);
    document.addEventListener("selectionchange", clear);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", clear);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [root, key, ready]);
  function capture() {
    const node = root.current;
    const selection = ready && node ? captureSelectedText(node) : null;
    if (!selection || !node) {
      setPending(null);
      return;
    }
    const range = node.ownerDocument.getSelection()!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setError("");
    setPending({
      selection,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 200)),
      top:
        rect.bottom + 48 < window.innerHeight
          ? rect.bottom + 8
          : Math.max(8, rect.top - 44),
    });
  }
  return {
    onMouseUp: capture,
    onKeyUp: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPending(null);
        root.current?.ownerDocument.getSelection()?.removeAllRanges();
      } else capture();
    },
    onTouchEnd: capture,
    overlay:
      pending && ready
        ? createPortal(
            <div
              className={styles.action}
              style={{ left: pending.left, top: pending.top }}
            >
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  try {
                    onSelected(pending.selection);
                    setPending(null);
                    root.current?.ownerDocument
                      .getSelection()
                      ?.removeAllRanges();
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "添加引用失败，请重试。",
                    );
                  }
                }}
              >
                <MessageSquarePlus aria-hidden="true" />
                添加到侧边聊天
              </button>
              {error && <p role="alert">{error}</p>}
            </div>,
            root.current!.ownerDocument.body,
          )
        : null,
  };
}
