import type { RobotAiDefaults } from "@solvemate/contracts";
import type { AiSettings } from "../ai/local-api";
import {
  resolveDefaults,
  configuredConnections,
  connectionFor,
  providerInfo,
} from "../ai/robot-config";
import { SettingsSelect } from "./SettingsSelect";
import styles from "./AiSettings.module.css";

/** 内部配置只引用已保存的连接和模型，不显示外部接入目录或检测操作。 */
export function RobotAiFields({
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
        placeholder="未配置"
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
          onChange({ connectionId, modelId });
        }}
      />
      <SettingsSelect
        label="模型"
        value={
          models.some((item) => item.value === effective.model)
            ? effective.model
            : ""
        }
        disabled={disabled || !selected || !models.length}
        placeholder="未配置"
        options={models}
        onValueChange={(modelId) =>
          onChange({ connectionId: effective.connectionId || null, modelId })
        }
      />
      <div className={styles.source}>
        <span>{config === null ? "全局配置" : "独立配置"}</span>
        {config !== null && (
          <button disabled={disabled} onClick={() => onChange(null)}>
            使用全局配置
          </button>
        )}
      </div>
      {effective.error && (
        <p className={styles.problem} role="alert">
          {effective.error}
        </p>
      )}
    </div>
  );
}
