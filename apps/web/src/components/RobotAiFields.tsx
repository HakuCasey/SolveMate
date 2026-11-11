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
  const selected = connectionFor(settings, effective.connectionId);
  const models = selected?.detection.models ?? [];
  const retained =
    !!effective.connectionId &&
    !choices.some((item) => item.id === effective.connectionId);
  return (
    <div className={styles.settings}>
      <SettingsSelect
        label="AI 服务"
        value={effective.connectionId}
        disabled={disabled || !choices.length}
        placeholder="未配置"
        options={[
          ...(retained
            ? [
                {
                  value: effective.connectionId,
                  name: selected
                    ? `${providerInfo(selected.config.provider, settings).name}（不可用）`
                    : `${effective.harness || "原连接"}（${effective.deleted ? "已删除" : "不可用"}）`,
                  disabled: true,
                },
              ]
            : []),
          ...choices.map((item) => ({
            value: item.id,
            name: providerInfo(item.config.provider, settings).name,
          })),
        ]}
        onValueChange={(connectionId) => {
          const connection = connectionFor(settings, connectionId)!;
          onChange({ connectionId, modelId: connection.config.model });
        }}
      />
      <SettingsSelect
        label="模型"
        value={effective.model}
        disabled={
          disabled || !selected?.enabled || selected?.check.status === "error"
        }
        placeholder="未配置"
        options={[
          ...(effective.model &&
          !models.some((item) => item.value === effective.model)
            ? [
                {
                  value: effective.model,
                  name: `${effective.model}（不可用）`,
                  disabled: true,
                },
              ]
            : []),
          ...models,
        ]}
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
