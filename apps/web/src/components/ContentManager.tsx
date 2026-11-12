import { useEffect } from "react";
import { BookOpen, ListChecks, RefreshCw, X } from "lucide-react";
import type { OfficialContent } from "../content/useOfficialContent";
import type { OfficialLibrary } from "../content/library";
import { OfficialContentActions } from "./OfficialContentActions";
import styles from "./ContentManager.module.css";

interface Props {
  content: OfficialContent;
  library: OfficialLibrary;
  operation: { busy: boolean; error: string };
  onInstall: (id: string, update: boolean) => Promise<boolean>;
  onRead: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}
export function ContentManager({
  content,
  library,
  operation,
  onInstall,
  onRead,
  onRemove,
}: Props) {
  const { checking, connectionError, transfer, refresh } = content;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const busy =
    !!transfer &&
    ["downloading", "verifying", "saving"].includes(transfer.phase);
  return (
    <section className={styles.page} aria-label="官方内容">
      <header className={styles.heading}>
        <div>
          <h1>官方内容</h1>
          <p>下载官方资料，或打开已下载的资料阅读。</p>
        </div>
        <button
          className={styles.secondary}
          disabled={checking || busy || operation.busy}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {checking ? "正在检查内容更新…" : "检查内容更新"}
        </button>
      </header>
      {connectionError && (
        <p className={styles.notice} role="alert">
          {connectionError}
        </p>
      )}
      {operation.error && (
        <p className={styles.notice} role="alert">
          {operation.error}
        </p>
      )}
      <div className={styles.list}>
        {library.entries.map((item) => {
          const { source: entry, packageState: state } = item;
          const saved = item.downloaded ? state.saved : undefined;
          const currentTransfer =
            transfer?.courseId === entry.id ? transfer : null;
          const pending =
            currentTransfer &&
            ["downloading", "verifying", "saving"].includes(
              currentTransfer.phase,
            );
          const { title, description } = item;
          const Icon = item.kind === "questions" ? ListChecks : BookOpen;
          return (
            <OfficialContentActions
              key={item.id}
              item={item}
              onRemove={onRemove}
            >
              <article className={styles.card} key={item.id} aria-label={title}>
                <div className={styles.cardTitle}>
                  <span className={styles.icon}>
                    <Icon aria-hidden="true" />
                  </span>
                  <h2 title={title}>{title}</h2>
                  <div className={styles.actions}>
                    {item.downloaded && (
                      <button
                        className={styles.primary}
                        onClick={() => void onRead(item.id)}
                      >
                        阅读
                      </button>
                    )}
                    {pending && currentTransfer.phase !== "saving" ? (
                      <button
                        className={styles.secondary}
                        onClick={content.cancel}
                      >
                        <X aria-hidden="true" />
                        取消下载
                      </button>
                    ) : !item.downloaded || state.updateAvailable ? (
                      <button
                        className={saved ? styles.secondary : styles.primary}
                        disabled={
                          busy ||
                          checking ||
                          !item.canAcquire ||
                          (!!connectionError && !state.saved) ||
                          operation.busy
                        }
                        onClick={() =>
                          void onInstall(item.id, item.downloaded).catch(
                            () => undefined,
                          )
                        }
                      >
                        {saved ? "更新" : "下载"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className={styles.description} title={description}>
                  {description}
                </p>
                <div className={styles.tags} aria-label="资料分类">
                  <span>{item.subjectTitle}</span>
                  <span>{item.kind === "questions" ? "题目" : "学习资料"}</span>
                </div>
                <p className={styles.date}>
                  {saved && Number.isFinite(saved.installedAt) ? (
                    <>
                      更新日期{" "}
                      <time
                        dateTime={new Date(saved.installedAt).toISOString()}
                      >
                        {new Date(saved.installedAt).toLocaleDateString(
                          "zh-CN",
                          {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          },
                        )}
                      </time>
                    </>
                  ) : saved ? (
                    "更新日期未知"
                  ) : (
                    "尚未下载"
                  )}
                </p>
                {state.unknown && (
                  <p className={styles.noticeInline}>
                    本地版本暂无法核对，仍可阅读。
                  </p>
                )}
                {currentTransfer && currentTransfer.phase !== "done" && (
                  <div
                    className={styles.transfer}
                    role={
                      currentTransfer.phase === "error" ? "alert" : "status"
                    }
                  >
                    {pending ? (
                      <>
                        <span>
                          {currentTransfer.phase === "saving"
                            ? "正在保存…"
                            : currentTransfer.phase === "verifying"
                              ? "正在校验…"
                              : currentTransfer.total
                                ? `正在下载 ${Math.round((currentTransfer.received / currentTransfer.total) * 100)}%`
                                : "正在获取版本…"}
                        </span>
                        <progress
                          aria-label={`${title}下载进度`}
                          max={currentTransfer.total || 1}
                          value={currentTransfer.received}
                        />
                      </>
                    ) : (
                      currentTransfer.message
                    )}
                  </div>
                )}
              </article>
            </OfficialContentActions>
          );
        })}
      </div>
    </section>
  );
}
