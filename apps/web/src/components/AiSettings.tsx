import { useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { AlertDialog } from "radix-ui";
import {
  localAi,
  LocalAiError,
  type AiConfig,
  type AiSettings as Settings,
  type Detection,
} from "../ai/local-api";
import {
  AI_PROVIDERS,
  defaultConnection,
  resolveDefaults,
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
  const [draft, setDraft] = useState<AiConfig>(
    initialConnection?.config ?? { ...empty },
  );
  const [manualPath, setManualPath] = useState(
    !!initialConnection?.config.executablePath,
  );
  const [detection, setDetection] = useState<Detection | null>(
    initialConnection?.detection ?? null,
  );
  const [operation, setOperation] = useState<
    "detect" | "save" | "manage" | "delete" | null
  >(null);
  const savedConnection = settings?.connections.find(
    (item) => item.config.provider === provider,
  );
  const globalDefault = resolveDefaults(null, settings);
  const busy = operation !== null;
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
  const deleteTrigger = useRef<HTMLButtonElement>(null);

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
          : !detection
            ? failed
              ? "请检查上方错误说明，再点击“检测连接”。"
              : "请先点击“检测连接”，获取可用模型后再保存。"
            : !modelAvailable
              ? "请选择一个可用模型后再保存。"
              : "";

  async function detect(
    model = "",
    executablePath = draft.executablePath,
    resetProbe = false,
  ) {
    setProbeRecovery(false);
    setOperation("detect");
    setStatus("正在检测 Harness 与模型列表…");
    setFailed(false);
    try {
      let resolvedPath = executablePath;
      const result = await detectConnection(
        executablePath,
        model,
        settings?.services?.find((item) => item.provider === draft.provider)
          ?.defaultPath ??
          settings?.defaultPath ??
          "",
        (path) => {
          resolvedPath = path;
          setManualPath(true);
          setDraft((previous) => ({ ...previous, executablePath: path }));
          setStatus("正在检测默认安装位置…");
        },
        (path, selected) =>
          localAi.detect(path, selected, draft.provider, resetProbe),
      );
      setDetection(result);
      setDraft((previous) => ({
        ...previous,
        executablePath: resolvedPath,
        model: result.currentModel,
        reasoningEffort: result.currentReasoning,
      }));
      setStatus(`已找到 ${result.models.length} 个模型。`);
      await onRefresh();
    } catch (error) {
      setDetection(null);
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
      const next = await localAi.save(draft, settings, {
        enabled: savedConnection?.enabled ?? true,
        makeDefault:
          !settings?.defaultConnectionId && settings?.connections.length === 0,
      });
      onSaved(next);
      showSaved();
      setStatus("AI 配置已保存。");
    } catch (error) {
      setFailed(true);
      await onRefresh();
      if (error instanceof LocalAiError && error.code === "program_missing") {
        setDetection(null);
        setManualPath(true);
        setDraft((previous) => ({
          ...previous,
          executablePath:
            previous.executablePath ||
            settings?.services?.find((item) => item.provider === draft.provider)
              ?.defaultPath ||
            settings?.defaultPath ||
            "",
        }));
      }
      setStatus(error instanceof Error ? error.message : "保存 AI 配置失败。");
    } finally {
      setOperation(null);
    }
  }

  async function manage(action: "enabled" | "default") {
    if (!savedConnection || !settings) return;
    setOperation("manage");
    setFailed(false);
    try {
      const next =
        action === "default"
          ? await localAi.setDefaultConnection(
              savedConnection.id,
              settings.preferencesRevision,
            )
          : await localAi.setConnectionEnabled(
              savedConnection.id,
              !savedConnection.enabled,
              savedConnection.revision,
            );
      onSaved(next);
      showSaved();
      setStatus(
        action === "default"
          ? "已设为全局默认。"
          : savedConnection.enabled
            ? "已停用该连接，其他连接仍可使用。"
            : "已启用该连接。",
      );
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "修改连接失败。");
      await onRefresh();
    } finally {
      setOperation(null);
    }
  }

  function reset() {
    setProbeRecovery(false);
    setDraft(
      savedConnection?.config ?? {
        ...empty,
        provider: provider as AiConfig["provider"],
      },
    );
    setManualPath(!!savedConnection?.config.executablePath);
    setDetection(savedConnection?.detection ?? null);
    setStatus("已取消本次修改。");
    setFailed(false);
  }

  function finishDelete(next: Settings) {
    onSaved(next);
    setDraft({ ...empty, provider: provider as AiConfig["provider"] });
    setDetection(null);
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
    <section className={styles.settings} aria-labelledby="ai-settings-heading">
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
              deleteTrigger.current?.focus();
            }}
          >
            <AlertDialog.Title>删除 AI 连接</AlertDialog.Title>
            <AlertDialog.Description>
              {`确定删除“${pendingDelete?.name ?? ""}”的连接配置吗？已有对话和教师配置保留，使用该连接时需要重新配置。`}
              {pendingDelete?.isDefault
                ? "此连接是全局默认，删除后需要重新选择默认连接。"
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
                {operation === "delete" ? "删除中…" : "删除连接"}
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
          setDraft(
            connection?.config ?? {
              ...empty,
              provider: value as AiConfig["provider"],
            },
          );
          setDetection(connection?.detection ?? null);
          setManualPath(!!connection?.config.executablePath);
          setStatus("");
          setFailed(false);
        }}
        options={[
          ...(settings?.services ?? AI_PROVIDERS).map((item) => ({
            value: item.provider,
            name: `${item.name}（${settings?.connections.some((connection) => connection.config.provider === item.provider) ? "已配置" : "未配置"}）`,
          })),
        ]}
      />
      <p className={styles.hint}>
        全局默认：
        {globalDefault.configured
          ? `${globalDefault.label}${globalDefault.error ? "（不可用）" : ""}`
          : "未设置"}
      </p>
      {savedConnection && (
        <div className={styles.connections}>
          <button
            disabled={busy || !!settings?.busy}
            onClick={() => void manage("enabled")}
          >
            {savedConnection.enabled ? "停用连接" : "启用连接"}
          </button>
          <button
            disabled={
              busy ||
              !savedConnection.enabled ||
              savedConnection.check.status === "error" ||
              settings?.defaultConnectionId === savedConnection.id
            }
            onClick={() => void manage("default")}
          >
            {settings?.defaultConnectionId === savedConnection.id
              ? "全局默认"
              : "设为全局默认"}
          </button>
          <button
            className={styles.deleteConnection}
            ref={deleteTrigger}
            disabled={busy || !!settings?.busy}
            onClick={() => {
              if (!settings) return;
              setDeleteError("");
              setPendingDelete({
                id: savedConnection.id,
                revision: savedConnection.revision,
                preferencesRevision: settings.preferencesRevision,
                name:
                  settings.services.find(
                    (item) => item.id === savedConnection.id,
                  )?.name ?? provider,
                isDefault: settings.defaultConnectionId === savedConnection.id,
              });
            }}
          >
            删除连接
          </button>
        </div>
      )}
      {savedConnection?.check.status === "error" && (
        <p role="alert" className={styles.problem}>
          {savedConnection.check.error}
        </p>
      )}
      {
        <>
          {manualPath && (
            <label>
              安装路径
              <input
                aria-label="安装路径"
                value={draft.executablePath}
                disabled={busy}
                placeholder="填写应用或程序的完整路径"
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    executablePath: event.target.value,
                    model: "",
                    reasoningEffort: "",
                  });
                  setDetection(null);
                  setStatus("");
                  setFailed(false);
                }}
              />
            </label>
          )}
          <div className={styles.detect}>
            <button onClick={() => void detect(draft.model)} disabled={busy}>
              {operation === "detect" ? (
                <LoaderCircle className={styles.spinning} aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {operation === "detect" ? "检测中…" : "检测连接"}
            </button>
          </div>
          {detection && (
            <>
              <SettingsSelect
                label="默认模型"
                disabled={busy}
                value={draft.model}
                onValueChange={(value) => {
                  setDraft({ ...draft, model: value });
                  void detect(value);
                }}
                options={detection.models}
              />
              {!!detection.reasoningOptions.length && (
                <SettingsSelect
                  label="推理强度"
                  disabled={busy}
                  value={draft.reasoningEffort}
                  onValueChange={(value) =>
                    setDraft({ ...draft, reasoningEffort: value })
                  }
                  options={detection.reasoningOptions.map((option) => ({
                    ...option,
                    name:
                      { off: "不启用推理", low: "低", high: "高", max: "最高" }[
                        option.value
                      ] ?? option.name,
                  }))}
                />
              )}
            </>
          )}
        </>
      }
      {status && !busy && (
        <p
          className={failed ? styles.problem : styles.status}
          role={failed ? "alert" : "status"}
        >
          {!failed && !busy && <Check aria-hidden="true" />}
          {status}
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
      {saveBlockedReason && (
        <p id="ai-save-requirement" className={styles.hint} role="status">
          {saveBlockedReason}
        </p>
      )}
      <div className={styles.actions}>
        <button onClick={reset} disabled={busy}>
          取消修改
        </button>
        <button
          className={styles.primary}
          onClick={() => void save()}
          disabled={!!saveBlockedReason}
          aria-describedby={
            saveBlockedReason ? "ai-save-requirement" : undefined
          }
        >
          {operation === "save" ? "保存中…" : "保存配置"}
        </button>
      </div>
    </section>
  );
}
