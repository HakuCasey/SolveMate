import { useState } from "react";
import { Download, ExternalLink, RotateCcw } from "lucide-react";
import type { Settings } from "@solvemate/contracts";
import {
  DEFAULT_CONTENT_SERVICE_URL,
  contentApiBase,
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
  const saved = contentApiBase(settings.contentServiceUrl);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeContentServiceUrl(draft);
  const defaultUrl = normalizeContentServiceUrl(DEFAULT_CONTENT_SERVICE_URL);
  const changed =
    (normalized ?? (draft.trim() || defaultUrl)) !==
    normalizeContentServiceUrl(saved);

  function save() {
    const problem = contentServiceUrlError(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onSave({
      ...settings,
      contentServiceUrl: normalized === defaultUrl ? undefined : normalized,
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
      <div className={styles.actions}>
        <button
          className={`${styles.action} ${styles.open}`}
          type="button"
          onClick={onOpenContent}
        >
          <Download aria-hidden="true" />
          社区内容
        </button>
        <a
          className={styles.action}
          href="https://hakucasey.github.io/SolveMate/"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink aria-hidden="true" />
          软件官网
        </a>
      </div>
      <label className={styles.field}>
        <span>地址</span>
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
          inputMode="url"
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={`${styles.action} ${styles.primary}`}
          type="submit"
          disabled={!changed}
        >
          保存
        </button>
        <button
          className={styles.action}
          type="button"
          disabled={draft === DEFAULT_CONTENT_SERVICE_URL}
          onClick={() => {
            setDraft(DEFAULT_CONTENT_SERVICE_URL);
            setError(null);
          }}
        >
          <RotateCcw aria-hidden="true" />
          恢复默认
        </button>
      </div>
    </form>
  );
}
