import type { RobotAiDefaults } from "@solvemate/contracts";
import type { AiSettings } from "../ai/local-api";
import {
  resolveDefaults,
  configuredConnections,
  connectionFor,
  providerInfo,
  reasoningAfterModelChange,
} from "../ai/robot-config";
import { SettingsSelect } from "./SettingsSelect";
import styles from "./AiSettings.module.css";

/** 内部选择只引用已连接服务的模型目录；连接检测与安装路径由 AI 配置管理。 */
export function AiSelectionFields({
  config,
  settings,
  onChange,
  disabled = false,
}: {
  config: RobotAiDefaults;
  settings: AiSettings | null;
  onChange: (config: RobotAiDefaults) => void;
  disabled?: boolean;
}) {
  const effective = resolveDefaults(config, settings),
    choices = configuredConnections(settings);
  const selected = choices.find((item) => item.id === effective.connectionId);
  const models = selected?.detection.models ?? [];
  return (
    <div className={styles.settings}>
      <SettingsSelect
        label="AI 服务"
        value={selected?.id ?? ""}
        disabled={disabled || !choices.length}
        placeholder="请选择"
        options={[
          ...choices.map((item) => ({
            value: item.id,
            name: providerInfo(item.config.provider, settings).name,
          })),
        ]}
        onValueChange={(connectionId) => {
          const connection = connectionFor(settings, connectionId)!;
          const modelId = connection.detection.models.some(
            (item) => item.value === connection.config.model,
          )
            ? connection.config.model
            : null;
          onChange({
            connectionId,
            modelId,
            reasoningEffort: reasoningAfterModelChange(
              connection.detection,
              modelId ?? "",
              connection.config.reasoningEffort,
            ),
          });
        }}
      />
      <SettingsSelect
        label="模型"
        className={styles.modelField}
        value={
          models.some((item) => item.value === effective.model)
            ? effective.model
            : ""
        }
        disabled={disabled || !selected || !models.length}
        placeholder="请选择"
        options={models}
        onValueChange={(modelId) =>
          onChange({
            connectionId: effective.connectionId || null,
            modelId,
            reasoningEffort: reasoningAfterModelChange(
              selected!.detection,
              modelId,
              effective.reasoningEffort,
            ),
          })
        }
      />
      <SettingsSelect
        label="推理等级"
        className={styles.modelField}
        value={
          effective.reasoningOptions.some(
            (item) => item.value === effective.reasoningEffort,
          )
            ? effective.reasoningEffort
            : ""
        }
        disabled={disabled || !selected || !effective.reasoningOptions.length}
        placeholder="暂无可选等级"
        options={effective.reasoningOptions}
        onValueChange={(reasoningEffort) =>
          onChange({
            connectionId: effective.connectionId || null,
            modelId: effective.model || null,
            reasoningEffort,
          })
        }
      />
      {config !== null && (
        <div className={styles.source}>
          <button disabled={disabled} onClick={() => onChange(null)}>
            使用全局配置
          </button>
        </div>
      )}
      {effective.error && (
        <p className={styles.problem} role="alert">
          {effective.error}
        </p>
      )}
    </div>
  );
}
