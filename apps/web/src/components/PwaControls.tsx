import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { logError } from "../logger";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaControls({ saved }: { saved: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      logError("Failed to register the offline service worker.", error);
      setRegistrationFailed(true);
    },
  });

  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      let cancelled = false;
      void navigator.serviceWorker.ready.then(() => {
        if (!cancelled) setReady(true);
      });
      return () => {
        cancelled = true;
      };
    }
  }, []);

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
          : registrationFailed
            ? "离线资源准备失败，请重新打开页面"
            : ready
              ? "离线资源已就绪"
              : "正在准备离线资源…"}
      </span>
      {needRefresh && (
        <button
          disabled={!saved}
          onClick={() => {
            void updateServiceWorker(true).catch((error: unknown) =>
              logError("Failed to update the application.", error),
            );
          }}
        >
          更新应用
        </button>
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
