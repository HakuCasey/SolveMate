import { useEffect, useState } from "react";
import { useAppUpdate } from "../pwa/useAppUpdate";
import { useSaveFeedback } from "./SaveFeedback";
import { RefreshCw } from "lucide-react";
import styles from "./PwaControls.module.css";
import { logError } from "../logger";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaControls({ prepareReload }: { prepareReload: () => void }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const showNotice = useSaveFeedback();
  const { state, offlineReady, supported, check, reload } = useAppUpdate(
    prepareReload,
    () => showNotice("新版已就绪，可在右下角点击“更新应用”"),
  );
  const busy = ["checking", "downloading", "reloading"].includes(state.status);
  const label =
    state.status === "checking"
      ? "正在检查更新…"
      : state.status === "downloading"
        ? "正在下载更新…"
        : state.status === "current"
          ? "已是最新版本"
          : state.status === "reloading"
            ? "正在更新应用…"
            : state.status === "ready"
              ? "更新应用"
              : state.status === "error"
                ? "重试"
                : "检查更新";

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <>
      <span role="status">
        {!import.meta.env.PROD
          ? "开发预览"
          : offlineReady
            ? "离线资源已就绪"
            : !supported
              ? "当前浏览器不支持离线应用"
              : state.status === "error"
                ? "离线资源尚未就绪"
                : "正在准备离线资源…"}
      </span>
      {supported && (
        <span className={styles.update} aria-label="应用更新">
          {state.status === "ready" && <span role="status">新版已就绪</span>}
          {state.error && <span role="alert">{state.error}</span>}
          <button
            type="button"
            disabled={busy}
            aria-label={label}
            aria-busy={busy}
            onClick={state.status === "ready" ? reload : check}
          >
            <RefreshCw
              aria-hidden="true"
              className={busy ? styles.spinning : undefined}
            />
            <span role="status">{label}</span>
          </button>
        </span>
      )}
      {installPrompt && (
        <button
          onClick={() => {
            void install().catch((error: unknown) =>
              logError("Failed to show the installation prompt.", error),
            );
          }}
        >
          安装应用
        </button>
      )}
    </>
  );
}
