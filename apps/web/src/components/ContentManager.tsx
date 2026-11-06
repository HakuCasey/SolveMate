import { useEffect } from "react";
import { BookOpen, Check, Download, RefreshCw, X } from "lucide-react";
import type { OfficialContent } from "../content/useOfficialContent";
import type { InstalledCourse } from "../content/storage";
import styles from "./ContentManager.module.css";

interface Props {
  content: OfficialContent;
  onInstall: (id: string) => Promise<InstalledCourse | null>;
  onRead: (id: string) => void;
}
export function ContentManager({ content, onInstall, onRead }: Props) {
  const {
    snapshot,
    remote,
    updates,
    checking,
    connectionError,
    transfer,
    refresh,
  } = content;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const busy =
    !!transfer &&
    ["downloading", "verifying", "saving"].includes(transfer.phase);
  const entries = remote.length
    ? remote
    : snapshot.activeCourses.map((course) => ({
        ...course,
        description: "当前本地内容",
        release: "",
      }));
  return (
    <section className={styles.page} aria-label="官方内容">
      <header className={styles.heading}>
        <div>
          <h1>官方内容</h1>
          <p>下载后可离线阅读。更新失败时，继续使用已保存的版本。</p>
        </div>
        <button
          className={styles.secondary}
          disabled={checking || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {checking ? "正在检查…" : "检查更新"}
        </button>
      </header>
      {connectionError && (
        <p className={styles.notice} role="alert">
          {connectionError}
        </p>
      )}
      <div className={styles.list}>
        {entries.map((entry) => {
          const head = snapshot.heads.find(
            (head) => head.courseId === entry.id,
          );
          const saved = snapshot.installed.find(
            (item) =>
              item.courseId === entry.id && item.version === head?.version,
          );
          const local = snapshot.activeCourses.find(
            (course) => course.id === entry.id,
          );
          const update = updates[entry.id];
          const currentTransfer =
            transfer?.courseId === entry.id ? transfer : null;
          const pending =
            currentTransfer &&
            ["downloading", "verifying", "saving"].includes(
              currentTransfer.phase,
            );
          const unknown = update?.status === "unknown_version";
          const current = !!saved && update?.status === "up_to_date";
          return (
            <article
              className={styles.card}
              key={entry.id}
              aria-label={entry.title}
            >
              <div className={styles.cardTitle}>
                <span className={styles.icon}>
                  <BookOpen aria-hidden="true" />
                </span>
                <div>
                  <h2>{entry.title}</h2>
                  <p>{entry.description}</p>
                </div>
                <span className={styles.badge}>
                  {saved ? "已下载" : local ? "随应用提供" : "未下载"}
                </span>
              </div>
              <div className={styles.details}>
                <span>
                  {saved
                    ? `本地版本：${saved.manifest.course.release} · ${saved.version.slice(0, 8)}`
                    : local
                      ? "当前可使用应用内的基础内容"
                      : "下载后出现在学科菜单中"}
                </span>
                {saved && (
                  <span>
                    保存于 {new Date(saved.installedAt).toLocaleString("zh-CN")}
                  </span>
                )}
                {update && (
                  <span>
                    {current
                      ? "已是最新版本"
                      : unknown
                        ? "本地版本暂无法核对，已保留"
                        : saved
                          ? "发现可下载的新版本"
                          : "可下载官方课程包"}
                    {` · ${(update.latest.size_bytes / 1024).toFixed(1)} KB`}
                  </span>
                )}
              </div>
              {currentTransfer && (
                <div
                  className={styles.transfer}
                  role={currentTransfer.phase === "error" ? "alert" : "status"}
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
                        aria-label={`${entry.title}下载进度`}
                        max={currentTransfer.total || 1}
                        value={currentTransfer.received}
                      />
                    </>
                  ) : (
                    currentTransfer.message
                  )}
                </div>
              )}
              <footer className={styles.actions}>
                {local && (
                  <button
                    className={styles.secondary}
                    onClick={() => onRead(entry.id)}
                  >
                    继续阅读
                  </button>
                )}
                {pending && currentTransfer.phase !== "saving" ? (
                  <button className={styles.secondary} onClick={content.cancel}>
                    <X aria-hidden="true" />
                    取消下载
                  </button>
                ) : (
                  <button
                    className={styles.primary}
                    disabled={
                      busy ||
                      checking ||
                      !update ||
                      current ||
                      unknown ||
                      !!connectionError
                    }
                    onClick={() => void onInstall(entry.id)}
                  >
                    {current ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                    {current ? "已是最新" : saved ? "下载更新" : "下载到本地"}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
