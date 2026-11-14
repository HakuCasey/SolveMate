import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { reopenApplication } from "../pwa/reopen";
import { logError } from "../logger";

/** 启动失败时保留直接重开的入口，不依赖工作区或等待版本的状态。 */
export function StartupUpdate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function reopen() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await reopenApplication();
    } catch (failure) {
      logError("Failed to reopen the current application page.", failure);
      setError(
        failure instanceof Error
          ? failure.message
          : "无法重新打开，请重试。原记录未修改。",
      );
      setBusy(false);
    }
  }
  return (
    <section aria-label="重新打开应用">
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void reopen()}>
        <RefreshCw size={16} aria-hidden="true" />
        {busy ? "正在重新打开…" : "更新并重新打开"}
      </button>
    </section>
  );
}
