import { SidebarToggle } from "./SidebarLayout";
import type { PersonalMaterials } from "../materials/useMaterials";
import { OfficialTools } from "../research/OfficialTools";
import type { TeachingTools } from "../research/useTeachingTools";
import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import { BookOpen, ListChecks, RefreshCw, X } from "lucide-react";
import type { OfficialContent } from "../content/useOfficialContent";
import type { OfficialLibrary } from "../content/library";
import { contentApiBase, useContentServiceUrl } from "../content/settings";
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
  const [activity, setActivity] = useState<
    "idle" | "checking" | "result" | "updating"
  >("idle");
  const checkButton = useRef<HTMLButtonElement>(null);
  const configuredServiceUrl = useContentServiceUrl();
  const refreshTools = tools.refresh;
  const toolUpdates = tools.remote.filter((release) =>
    tools.items.some(
      (tool) =>
        tool.source === "official" &&
        tool.id === release.id &&
        tool.version !== release.latest_version,
    ),
  );
  const materialUpdates = library.entries.filter(
    (item) => item.downloaded && item.packageState.updateAvailable,
  );
  const availableUpdates = toolUpdates.length + materialUpdates.length;
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
  const checkError = connectionError || tools.error;
  const result = checkError
    ? "未能检查全部社区内容，请重试。"
    : !checkedAt
      ? "未能完成检查，请重试。"
      : availableUpdates > 0
        ? `有 ${availableUpdates} 项内容可更新。`
        : unknownVersions
          ? "部分本地版本暂无法核对。"
          : unverifiedVersions
            ? "本地版本已变化，请重新检查。"
            : library.entries.some((item) => item.downloaded) ||
                tools.items.some((tool) => tool.source === "official")
              ? "已下载的社区内容均为最新版本。"
              : "暂无已下载的社区内容。";

  async function updateAvailable() {
    setActivity("updating");
    try {
      for (const item of materialUpdates) {
        if (!(await onInstall(item.id, true))) return;
      }
      for (const tool of toolUpdates) await tools.download(tool);
    } catch {
      // 资料和工具各自显示操作错误，已保存的更新继续可用。
    } finally {
      setActivity("idle");
    }
  }

  return (
    <section className={styles.page} aria-label="社区内容">
      <header className={styles.heading}>
        <SidebarToggle />
        <h1>社区内容</h1>
        <div className={styles.headingActions}>
          <button
            ref={checkButton}
            type="button"
            disabled={
              activity !== "idle" ||
              checking ||
              tools.checking ||
              busy ||
              operation.busy ||
              !!tools.busy
            }
            onClick={async () => {
              setActivity("checking");
              await Promise.all([refresh(), refreshTools()]);
              setActivity("result");
            }}
          >
            <RefreshCw aria-hidden="true" />
            {activity === "updating"
              ? "正在更新…"
              : checking || tools.checking || activity === "checking"
                ? "正在检查…"
                : "检查更新"}
          </button>
        </div>
      </header>
      <AlertDialog.Root
        open={activity === "result"}
        onOpenChange={(open) => {
          if (!open)
            setActivity((current) => (current === "result" ? "idle" : current));
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.resultOverlay} />
          <AlertDialog.Content
            className={styles.resultDialog}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              checkButton.current?.focus();
            }}
          >
            <AlertDialog.Title>检查结果</AlertDialog.Title>
            <AlertDialog.Description>{result}</AlertDialog.Description>
            <div className={styles.resultActions}>
              <AlertDialog.Cancel>确定</AlertDialog.Cancel>
              {!checkError && checkedAt && availableUpdates > 0 && (
                <AlertDialog.Action onClick={() => void updateAvailable()}>
                  更新
                </AlertDialog.Action>
              )}
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <div className={styles.body}>
        {configuredServiceUrl && (
          <p className={styles.notice} role="status">
            当前内容服务：<code>{contentApiBase(configuredServiceUrl)}</code>
            （在「系统设置 → 社区内容」中修改）
          </p>
        )}
        <h2 className={styles.sectionTitle}>资料库</h2>
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
            const publishedOn = item.publishedOn;
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
                            activity === "updating" ||
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
                  {publishedOn ? (
                    <p className={styles.date}>
                      社区更新 <time dateTime={publishedOn}>{publishedOn}</time>
                    </p>
                  ) : !saved ? (
                    <p className={styles.date}>尚未下载</p>
                  ) : null}
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
        <OfficialTools
          tools={tools}
          onUse={onUseTool}
          updating={activity === "updating"}
        />
      </div>
    </section>
  );
}
