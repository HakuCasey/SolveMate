import { useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import type { Settings } from "@solvemate/contracts";
import {
  DEFAULT_CONTENT_SERVICE_URL,
  contentServiceUrlError,
  normalizeContentServiceUrl,
} from "../content/settings";
import styles from "./ContentServiceSettings.module.css";

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onOpenContent: () => void;
}

/**
 * 社区内容服务的运行时配置。
 * 输入框默认填好内置地址；保存后内容接口会按新地址重新读取目录。
 */
export function ContentServiceSettings({
  settings,
  onSave,
  onOpenContent,
}: Props) {
  const saved = settings.contentServiceUrl ?? DEFAULT_CONTENT_SERVICE_URL;
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const changed =
    normalizeContentServiceUrl(draft) !== normalizeContentServiceUrl(saved);

  function save() {
    const problem = contentServiceUrlError(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const normalized = normalizeContentServiceUrl(draft);
    onSave({
      ...settings,
      ...(normalized
        ? { contentServiceUrl: normalized }
        : { contentServiceUrl: undefined }),
    });
    setDraft(normalized ?? DEFAULT_CONTENT_SERVICE_URL);
    setError(null);
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className={styles.field}>
        <span>内容服务地址</span>
        <input
          className={styles.input}
          value={draft}
          placeholder={DEFAULT_CONTENT_SERVICE_URL}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={!changed}>
          保存
        </button>
        <button
          className={styles.secondary}
          type="button"
          disabled={!changed}
          onClick={() => {
            setDraft(DEFAULT_CONTENT_SERVICE_URL);
            setError(null);
          }}
        >
          <RotateCcw aria-hidden="true" />
          恢复默认
        </button>
      </div>
      <button className={styles.open} type="button" onClick={onOpenContent}>
        <Download aria-hidden="true" />
        打开社区内容页
      </button>
    </form>
  );
}
