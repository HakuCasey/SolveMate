import { useEditValue } from "../refresh/useEditRevision";
import { useDraftBackup } from "../refresh/drafts";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Star, Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import {
  localAi,
  LocalAiError,
  type AiConfig,
  type AiSettings as Settings,
} from "../ai/local-api";
import {
  AI_PROVIDERS,
  defaultConnection,
  connectionIsConnected,
  globalModel,
  reasoningForModel,
} from "../ai/robot-config";
import { detectConnection } from "../ai/detect-connection";
import { SettingsSelect } from "./SettingsSelect";
import { useSaveFeedback } from "./SaveFeedback";
import styles from "./AiSettings.module.css";
import dialogStyles from "./ConversationSwitchDialog.module.css";

const empty: AiConfig = {
  provider: "deepseek-harness",
  executablePath: "",
  model: "",
  reasoningEffort: "",
};
type ConfigurationChanges = Partial<Omit<AiConfig, "provider">>;

export function AiSettings({
  settings,
  serviceError,
  onSaved,
  onRefresh,
}: {
  settings: Settings | null;
  serviceError: string;
  onSaved: (settings: Settings) => void;
  onRefresh: () => Promise<Settings | null>;
}) {
  const showSaved = useSaveFeedback();
  const initialConnection =
    defaultConnection(settings) ?? settings?.connections[0];
  const [provider, setProvider] = useState<string>(
    initialConnection?.config.provider ??
      settings?.services[0]?.provider ??
      "deepseek-harness",
  );
  const [changes, setChanges] = useState<ConfigurationChanges>({});
  const [manualPath, setManualPath] = useState(
    !!initialConnection?.config.executablePath,
  );
  const [operation, setOperation] = useState<
    "detect" | "save" | "manage" | "delete" | null
  >(null);
  const savedConnection = settings?.connections.find(
    (item) => item.config.provider === provider,
  );
  const savedConfig: AiConfig = savedConnection?.config ?? {
    ...empty,
    provider: provider as AiConfig["provider"],
  };
  // 已保存字段直接读取共享记录，只有用户尚未提交的改动留在表单中。
  const draft: AiConfig = { ...savedConfig, ...changes };
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedConfig);
  // 目录和连接状态都来自同一条本机连接记录，组件只保存未提交选项。
  const detection = savedConnection?.detection ?? null;
  const checkConfiguration = useEditValue(
    savedConnection?.config,
    savedConnection?.config,
    provider,
    true,
  );
  const connected = connectionIsConnected(savedConnection);
  const defaultModel = globalModel(settings);
  const reasoning = reasoningForModel(detection, draft.model);
  const busy = operation !== null;
  const modelControlsVisible =
    connected &&
    !!detection &&
    draft.executablePath === savedConnection?.config.executablePath;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (operation !== "detect") return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [operation]);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [probeRecovery, setProbeRecovery] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    revision: number;
    preferencesRevision: number;
    name: string;
    isDefault: boolean;
  } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  useDraftBackup(`ai-settings:${provider}`, "AI 连接配置草稿", draft, dirty);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const settingsRoot = useRef<HTMLElement>(null);

  const modelAvailable = detection?.models.some(
    (option) => option.value === draft.model,
  );
  const saveBlockedReason = !settings
    ? "连接本机 AI 服务后才能保存配置。"
    : operation === "detect"
      ? "正在检测 Harness 与模型列表，请稍候。"
      : operation === "save"
        ? "正在保存配置，请稍候。"
        : operation === "manage" || operation === "delete"
          ? "正在保存连接状态，请稍候。"
          : !connected
            ? "请检测连接，连接成功后即可使用。"
            : draft.executablePath !== savedConnection?.config.executablePath
              ? "安装路径已更改，请重新检测连接。"
              : !detection
                ? failed
                  ? "请检查上方错误说明，再点击“检测连接”。"
                  : "请先点击“检测连接”，获取可用模型后再保存。"
                : !modelAvailable
                  ? "请选择一个可用模型后再保存。"
                  : "";

  const feedback =
    status ||
    (savedConnection?.check.status === "error"
      ? savedConnection.check.error
      : "");
  const feedbackFailed = status
    ? failed
    : savedConnection?.check.status === "error";
  const showSaveHint =
    !!saveBlockedReason && operation !== "detect" && !feedbackFailed;

  function changeDraft(change: ConfigurationChanges) {
    if (!dirty) checkConfiguration.accept(savedConnection?.config);
    setChanges((previous) => {
      const next = { ...previous, ...change };
      for (const key of Object.keys(next) as (keyof ConfigurationChanges)[])
        if (next[key] === savedConfig[key]) delete next[key];
      return next;
    });
    setStatus("");
    setFailed(false);
  }

  function acceptConfiguration(next: Settings, replaceDraft = true) {
    const config = next.connections.find(
      (item) => item.config.provider === provider,
    )?.config;
    onSaved(next);
    checkConfiguration.accept(config);
    // 清除已提交改动后，模型、等级和路径一起从共享记录显示。
    if (replaceDraft && config) {
      setChanges({});
      setManualPath(!!config.executablePath);
    }
  }

  async function detect(
    model = "",
    executablePath = draft.executablePath,
    resetProbe = false,
  ) {
    setProbeRecovery(false);
    setElapsed(0);
    setOperation("detect");
    setStatus("正在检测 Harness 与模型列表…");
    setFailed(false);
    try {
      let detectionRevision = savedConnection?.revision ?? 0;
      const result = await detectConnection(
        executablePath,
        model,
        settings?.services?.find((item) => item.provider === draft.provider)
          ?.defaultPath ??
          settings?.defaultPath ??
          "",
        (path) => {
          setManualPath(true);
          changeDraft({ executablePath: path });
          setStatus("正在检测默认安装位置…");
        },
        async (path, selected) => {
          try {
            return await localAi.detect(
              path,
              selected,
              draft.provider,
              resetProbe,
              detectionRevision,
            );
          } catch (error) {
            if (
              error instanceof LocalAiError &&
              error.code === "program_missing"
            ) {
              const latest = await onRefresh();
              detectionRevision =
                latest?.connections.find(
                  (item) => item.config.provider === provider,
                )?.revision ?? 0;
            }
            throw error;
          }
        },
      );
      const next = await onRefresh();
      if (!next)
        throw new Error("连接检测已完成，但未能读取配置，请重新打开 AI 配置。");
      acceptConfiguration(next);
      setStatus(`连接成功，已获取 ${result.models.length} 个模型。`);
    } catch (error) {
      // 失败后保留后端目录，是否可操作只按刷新后的连接状态判断。
      setFailed(true);
      setProbeRecovery(
        error instanceof LocalAiError &&
          ["probe_uncertain", "probe_resume_failed"].includes(error.code),
      );
      if (
        error instanceof LocalAiError &&
        [
          "program_missing",
          "program_start_failed",
          "program_not_executable",
          "launcher_unsupported",
          "runtime_missing",
          "protocol_unsupported",
          "process_stopped",
        ].includes(error.code)
      )
        setManualPath(true);
      setStatus(error instanceof Error ? error.message : "连接检测失败。");
      await onRefresh();
    } finally {
      setOperation(null);
    }
  }

  async function save() {
    setProbeRecovery(false);
    setOperation("save");
    setFailed(false);
    try {
      checkConfiguration();
      const next = await localAi.save(draft, settings, {
        enabled: true,
        makeDefault: false,
      });
      acceptConfiguration(next);
      showSaved();
      setStatus("AI 配置已保存。");
    } catch (error) {
      await onRefresh();
      if (error instanceof LocalAiError && error.code === "program_missing") {
        setManualPath(true);
        changeDraft({
          executablePath:
            draft.executablePath ||
            settings?.services?.find((item) => item.provider === draft.provider)
              ?.defaultPath ||
            settings?.defaultPath ||
            "",
        });
      }
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "保存 AI 配置失败。");
    } finally {
      setOperation(null);
    }
  }

  async function setDefaultModel() {
    if (!savedConnection || !settings) return;
    setOperation("manage");
    setFailed(false);
    try {
      const next = await localAi.setDefaultConnection(
        savedConnection.id,
        settings.preferencesRevision,
        draft.model,
      );
      // 设为默认不提交推理等级，保留表单中尚未保存的选择。
      acceptConfiguration(next, false);
      showSaved("全局默认模型已保存");
      setStatus("全局默认模型已保存。");
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "设置默认模型失败。");
      await onRefresh();
    } finally {
      setOperation(null);
    }
  }

  function reset() {
    checkConfiguration.accept(savedConnection?.config);
    setProbeRecovery(false);
    setChanges({});
    setManualPath(!!savedConnection?.config.executablePath);
    setStatus("已取消本次修改。");
    setFailed(false);
  }

  function finishDelete(next: Settings) {
    checkConfiguration.accept(undefined);
    onSaved(next);
    setChanges({});
    setManualPath(false);
    setProbeRecovery(false);
    setPendingDelete(null);
    setFailed(false);
    setStatus("连接已删除。");
    showSaved("连接已删除");
  }

  async function removeConnection() {
    if (!pendingDelete) return;
    setOperation("delete");
    setDeleteError("");
    try {
      finishDelete(
        await localAi.deleteConnection(
          pendingDelete.id,
          pendingDelete.revision,
          pendingDelete.preferencesRevision,
        ),
      );
    } catch (error) {
      const current = await onRefresh();
      // 删除可能已完成但应答丢失，以重新读取的删除记录确认结果。
      if (current?.deletedConnectionIds?.includes(pendingDelete.id))
        finishDelete(current);
      else
        setDeleteError(
          error instanceof Error ? error.message : "删除失败，请重试。",
        );
    } finally {
      setOperation(null);
    }
  }

  return (
    <section
      ref={settingsRoot}
      className={styles.settings}
      aria-labelledby="ai-settings-heading"
    >
      <h3 id="ai-settings-heading">AI 配置</h3>
      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDelete(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            className={dialogStyles.overlay}
            data-connection-delete-dialog=""
          />
          <AlertDialog.Content
            className={dialogStyles.dialog}
            data-connection-delete-dialog=""
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // 删除成功后原按钮已移除，焦点回到仍存在的服务选择框。
              const target = deleteTrigger.current?.isConnected
                ? deleteTrigger.current
                : settingsRoot.current?.querySelector<HTMLButtonElement>(
                    '[aria-label="AI 服务"]',
                  );
              target?.focus({ preventScroll: true });
            }}
          >
            <AlertDialog.Title>删除 AI 配置</AlertDialog.Title>
            <AlertDialog.Description>
              {`确定删除“${pendingDelete?.name ?? ""}”的连接配置吗？对话保留。`}
              {pendingDelete?.isDefault
                ? "该服务包含全局默认模型，删除后需要重新选择默认模型。"
                : ""}
            </AlertDialog.Description>
            {deleteError && <p role="alert">{deleteError}</p>}
            <div className={dialogStyles.actions}>
              <AlertDialog.Cancel disabled={busy}>取消</AlertDialog.Cancel>
              <AlertDialog.Action
                className={styles.deleteConfirm}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void removeConnection();
                }}
              >
                {operation === "delete" ? "删除中…" : "删除配置"}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {!settings && (
        <div className={styles.problem} role="alert">
          <p>{serviceError || "正在连接本机 AI 服务…"}</p>
          <button onClick={() => void onRefresh()}>
            <RefreshCw aria-hidden="true" />
            重新连接
          </button>
        </div>
      )}
      <SettingsSelect
        label="AI 服务"
        disabled={busy || !settings}
        value={provider}
        onValueChange={(value) => {
          setProbeRecovery(false);
          setProvider(value);
          const connection = settings?.connections?.find(
            (item) => item.config.provider === value,
          );
          setChanges({});
          setManualPath(!!connection?.config.executablePath);
          setStatus("");
          setFailed(false);
        }}
        options={[
          ...(settings?.services ?? AI_PROVIDERS).map((item) => ({
            value: item.provider,
            name: `${item.name}（${connectionIsConnected(settings?.connections.find((connection) => connection.config.provider === item.provider)) ? "已连接" : "未连接"}）`,
          })),
        ]}
      />
      {
        <>
          {(manualPath || !!draft.executablePath) && (
            <label>
              安装路径
              <input
                aria-label="安装路径"
                value={draft.executablePath}
                disabled={busy}
                placeholder="填写应用或程序的完整路径"
                onChange={(event) => {
                  changeDraft({
                    executablePath: event.target.value,
                    model: "",
                    reasoningEffort: "",
                  });
                  setStatus("");
                  setFailed(false);
                }}
              />
            </label>
          )}
          <div
            className={styles.connectionActions}
            role="group"
            aria-label="连接操作"
          >
            <button
              className={styles.detectButton}
              onClick={() => void detect(draft.model)}
              disabled={busy || !settings}
            >
              {operation === "detect" ? (
                <LoaderCircle className={styles.spinning} aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {operation === "detect"
                ? `检测中… ${elapsed} 秒`
                : connected
                  ? "重新检测"
                  : "检测连接"}
            </button>
            <button
              className={styles.deleteConnection}
              ref={deleteTrigger}
              disabled={busy || !savedConnection}
              onClick={() => {
                if (!settings || !savedConnection) return;
                setDeleteError("");
                setPendingDelete({
                  id: savedConnection.id,
                  revision: savedConnection.revision,
                  preferencesRevision: settings.preferencesRevision,
                  name:
                    settings.services.find(
                      (item) => item.id === savedConnection.id,
                    )?.name ?? provider,
                  isDefault: defaultModel?.connectionId === savedConnection.id,
                });
              }}
            >
              <Trash2 aria-hidden="true" />
              删除配置
            </button>
          </div>
          {modelControlsVisible && detection && (
            <>
              <div className={styles.modelFields}>
                <SettingsSelect
                  label="模型"
                  className={styles.modelField}
                  disabled={busy}
                  value={draft.model}
                  onValueChange={(model) =>
                    changeDraft({
                      model,
                      reasoningEffort: reasoningForModel(detection, model)
                        .defaultValue,
                    })
                  }
                  options={detection.models}
                />
                <SettingsSelect
                  label="推理等级"
                  className={styles.modelField}
                  disabled={busy || !reasoning.options.length}
                  value={reasoning.options.length ? draft.reasoningEffort : ""}
                  placeholder={modelAvailable ? "暂无可选等级" : "请先选择模型"}
                  onValueChange={(reasoningEffort) =>
                    changeDraft({ reasoningEffort })
                  }
                  options={reasoning.options}
                />
              </div>
              {!defaultModel && (
                <p className={styles.hint}>当前未设置全局默认模型</p>
              )}
            </>
          )}
        </>
      }
      {feedback && (operation === "detect" || !busy) && (
        <p
          className={feedbackFailed ? styles.problem : styles.status}
          role={feedbackFailed ? "alert" : "status"}
          id={feedbackFailed ? "ai-save-requirement" : undefined}
        >
          {!feedbackFailed && !busy && <Check aria-hidden="true" />}
          <span>
            {feedback}
            {operation === "detect" && elapsed >= 5 && (
              <small className={styles.waiting}>
                正在等待服务返回检测结果。
              </small>
            )}
          </span>
        </p>
      )}
      {probeRecovery && (
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "将创建新的连接检测会话。请先确认原检测会话已不可用，是否继续？",
              )
            )
              void detect(draft.model, draft.executablePath, true);
          }}
        >
          重建检测会话
        </button>
      )}
      {showSaveHint && (
        <p id="ai-save-requirement" className={styles.hint} role="status">
          {saveBlockedReason}
        </p>
      )}
      <div className={`${styles.actions} ${styles.globalActions}`}>
        <button
          className={styles.defaultModelButton}
          disabled={
            busy ||
            !modelControlsVisible ||
            !modelAvailable ||
            (defaultModel?.connectionId === savedConnection?.id &&
              defaultModel?.modelId === draft.model)
          }
          onClick={() => void setDefaultModel()}
          title={
            defaultModel?.connectionId === savedConnection?.id &&
            defaultModel?.modelId === draft.model
              ? "当前全局默认模型"
              : "设为全局默认模型"
          }
        >
          <Star
            aria-hidden="true"
            fill={
              defaultModel?.connectionId === savedConnection?.id &&
              defaultModel?.modelId === draft.model
                ? "currentColor"
                : "none"
            }
          />
          {defaultModel?.connectionId === savedConnection?.id &&
          defaultModel?.modelId === draft.model
            ? "已默认"
            : "设为默认"}
        </button>
        <button onClick={reset} disabled={busy}>
          取消修改
        </button>
        <button
          className={styles.primary}
          onClick={() => void save()}
          disabled={!!saveBlockedReason}
          aria-describedby={
            showSaveHint || feedbackFailed ? "ai-save-requirement" : undefined
          }
        >
          {operation === "save" ? "保存中…" : "保存配置"}
        </button>
      </div>
    </section>
  );
}
