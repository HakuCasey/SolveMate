import { SidebarToggle } from "./SidebarLayout";
import type { PersonalMaterials } from "../materials/useMaterials";
import { OfficialTools } from "../research/OfficialTools";
import type { TeachingTools } from "../research/useTeachingTools";
import { useEffect } from "react";
import { BookOpen, Check, ListChecks, RefreshCw, X } from "lucide-react";
import type { OfficialContent } from "../content/useOfficialContent";
import type { OfficialLibrary } from "../content/library";
import { OfficialContentActions } from "./OfficialContentActions";
import styles from "./ContentManager.module.css";

interface Props {
  content: OfficialContent;
  tools: TeachingTools;
  onUseTool: () => void;
  library: OfficialLibrary;
  operation: { busy: boolean; error: string };
  onInstall: (id: string, update: boolean) => Promise<boolean>;
  onRead: (id: string) => Promise<void>;
  materials: PersonalMaterials;
}
export function ContentManager({
  content,
  tools,
  onUseTool,
  library,
  operation,
  onInstall,
  onRead,
  materials,
}: Props) {
  const { checking, connectionError, transfer, refresh, checkedAt } = content;
  const refreshTools = tools.refresh;
  const toolUpdates = tools.items.filter(
    (t) =>
      t.source === "official" &&
      tools.remote.some((r) => r.id === t.id && r.latest_version !== t.version),
  ).length;
  const availableUpdates =
    toolUpdates +
    library.entries.filter(
      (item) => item.downloaded && item.packageState.updateAvailable,
    ).length;
  const unknownVersions =
    tools.items.some(
      (t) =>
        t.source === "official" && !tools.remote.some((r) => r.id === t.id),
    ) ||
    library.entries.some(
      (item) => item.downloaded && item.packageState.unknown,
    );
  const unverifiedVersions = library.entries.some(
    (item) =>
      item.downloaded &&
      !item.packageState.current &&
      !item.packageState.updateAvailable &&
      !item.packageState.unknown,
  );
  useEffect(() => {
    void refresh();
    void refreshTools();
  }, [refresh, refreshTools]);
  const busy =
    !!transfer &&
    ["downloading", "verifying", "saving"].includes(transfer.phase);
  return (
    <section className={styles.page} aria-label="社区内容">
      <header className={styles.heading}>
        <SidebarToggle />
        <h1>社区内容</h1>
        <button
          className={styles.secondary}
          disabled={
            checking || tools.checking || busy || operation.busy || !!tools.busy
          }
          onClick={() => {
            void refresh();
            void refreshTools();
          }}
        >
          <RefreshCw aria-hidden="true" />
          {checking || tools.checking ? "正在检查内容更新…" : "检查内容更新"}
        </button>
      </header>
      <div className={styles.body}>
        {!checking &&
          !tools.checking &&
          !tools.error &&
          !connectionError &&
          checkedAt && (
            <p
              className={styles.checkResult}
              role="status"
              data-updates={availableUpdates > 0}
            >
              {availableUpdates > 0 ? (
                <RefreshCw aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {availableUpdates > 0
                ? `有 ${availableUpdates} 项内容可更新，仍可使用本地版本。`
                : unknownVersions
                  ? "检查完成，部分本地版本暂无法核对，仍可使用。"
                  : unverifiedVersions
                    ? "本地版本已变化，请重新检查内容更新。"
                    : library.entries.some((item) => item.downloaded) ||
                        tools.items.some((t) => t.source === "official")
                      ? "检查完成，已下载的社区内容均为最新版本。"
                      : "检查完成，可下载下列社区内容。"}
            </p>
          )}
        <OfficialTools tools={tools} onUse={onUseTool} />
        <h2 className={styles.sectionTitle}>学习资料与题目</h2>
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
            const saved = item.downloaded;
            const updatedAt = item.downloaded ? item.updatedAt : undefined;
            const currentTransfer =
              transfer?.courseId === entry.id && transfer.materialId === item.id
                ? transfer
                : null;
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
                library={materials}
                directory={library.directory}
              >
                <article
                  className={styles.card}
                  key={item.id}
                  aria-label={title}
                >
                  <div className={styles.cardTitle}>
                    <span className={styles.icon}>
                      <Icon aria-hidden="true" />
                    </span>
                    <h2 title={title}>
                      <span className={styles.titleText}>{title}</span>
                      {item.downloaded && state.updateAvailable && (
                        <span
                          className={styles.updateNotice}
                          title="有新版可更新"
                          aria-label="有新版可更新"
                        >
                          <RefreshCw aria-hidden="true" />
                          <span className={styles.updateLabel}>
                            有新版可更新
                          </span>
                        </span>
                      )}
                    </h2>
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
                            (!!connectionError && !item.canAcquire) ||
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
                    <span>
                      {item.kind === "questions" ? "题目" : "学习资料"}
                    </span>
                  </div>
                  <p className={styles.date}>
                    {saved &&
                    updatedAt !== undefined &&
                    Number.isFinite(updatedAt) ? (
                      <>
                        更新日期{" "}
                        <time dateTime={new Date(updatedAt!).toISOString()}>
                          {new Date(updatedAt!).toLocaleDateString("zh-CN", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          })}
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
      </div>
    </section>
  );
}
