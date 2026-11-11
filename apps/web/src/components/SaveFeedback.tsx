import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleCheck, X } from "lucide-react";
import styles from "./SaveFeedback.module.css";

const SaveFeedbackContext = createContext<((message?: string) => void) | null>(
  null,
);

/** 只在持久化成功后调用；放在应用外层，气泡关闭或页面切换不会丢失提示。 */
export function SaveFeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(
    null,
  );
  const sequence = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const show = useCallback(
    (message = "配置已保存") => setNotice({ id: ++sequence.current, message }),
    [],
  );
  const dismiss = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, 2000);
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    // 捕获阶段监听，点击其他控件时仍执行该控件原有操作。
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [notice, dismiss]);

  return (
    <SaveFeedbackContext.Provider value={show}>
      {children}
      {createPortal(
        <div className={styles.viewport} ref={container}>
          <div role="status" aria-live="polite" aria-atomic="true">
            {notice && (
              <div className={styles.notice} key={notice.id}>
                <CircleCheck className={styles.check} aria-hidden="true" />
                <span>{notice.message}</span>
                <button onClick={dismiss} aria-label="关闭提示">
                  <X aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </SaveFeedbackContext.Provider>
  );
}

export function useSaveFeedback() {
  const show = useContext(SaveFeedbackContext);
  if (!show) throw new Error("SaveFeedbackProvider is missing.");
  return show;
}
