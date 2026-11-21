import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, NotebookPen } from "lucide-react";
import { captureSelectedText, type SelectedText } from "./text-selection";
import type { ReadingReference } from "@solvemate/contracts";
import { useSelectionActions, type SelectionAction } from "./SelectionActions";
import styles from "./SelectionAction.module.css";

/** 浏览器选区只用于临时选择；确认添加后才交给应用保存引用。 */
export function useReadingSelection(
  root: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean,
  makeReference: (selection: SelectedText) => ReadingReference,
) {
  const actions = useSelectionActions();
  const [pending, setPending] = useState<{
    selection: SelectedText;
    rect: DOMRect;
  } | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!pending || !menu) return;
    const { rect } = pending;
    const { width, height } = menu.getBoundingClientRect();
    const viewport = menu.ownerDocument.documentElement;
    const gap = 8;
    const maxLeft = viewport.clientWidth - width - gap;
    const maxTop = viewport.clientHeight - height - gap;
    let left = rect.left;
    let top = rect.top - height - gap;
    if (top < gap) {
      top = rect.bottom + gap;
      // 选区较长、上下均放不下时，优先移到文字旁边。
      if (top > maxTop) {
        if (rect.right + gap <= maxLeft) left = rect.right + gap;
        else if (rect.left >= width + 2 * gap) left = rect.left - width - gap;
      }
    }
    menu.style.left = Math.max(gap, Math.min(left, maxLeft)) + "px";
    menu.style.top = Math.max(gap, Math.min(top, maxTop)) + "px";
  }, [pending, error]);
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
    setPending({ selection, rect });
  }
  function add(action: SelectionAction) {
    if (!pending) return;
    try {
      const reference = makeReference(pending.selection);
      (action === "chat" ? actions.onChat : actions.onNote)(reference);
      setPending(null);
      root.current?.ownerDocument.getSelection()?.removeAllRanges();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "添加失败，请重试。",
      );
    }
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
            <div ref={menuRef} className={styles.action}>
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => add("chat")}
              >
                <MessageSquarePlus aria-hidden="true" />
                添加到侧边对话
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => add("note")}
              >
                <NotebookPen aria-hidden="true" />
                添加到笔记
              </button>
              {error && <p role="alert">{error}</p>}
            </div>,
            root.current!.ownerDocument.body,
          )
        : null,
  };
}
