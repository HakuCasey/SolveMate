import { useDraftBackup } from "../refresh/drafts";
import { useState } from "react";
import type { Robot, RobotAiDefaults } from "@solvemate/contracts";
import type { AiSettings } from "../ai/local-api";
import { robotAiError } from "../ai/robot-config";
import { RobotAiFields } from "./RobotAiFields";
import styles from "./AiSettings.module.css";

export function RobotAiConfiguration({
  robot,
  saved,
  settings,
  onSave,
}: {
  robot: Robot;
  saved: RobotAiDefaults;
  settings: AiSettings | null;
  onSave: (config: RobotAiDefaults) => Promise<void>;
}) {
  const [config, setConfig] = useState(() => structuredClone(saved));
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(saved) !== JSON.stringify(config);
  const release = useDraftBackup(
    `robot-ai:${robot.id}`,
    `${robot.name}的 AI 配置草稿`,
    config,
    changed,
  );
  const error = robotAiError(config, settings);
  return (
    <section className={styles.settings} aria-labelledby="ai-settings-heading">
      <p className={styles.hint}>{robot.name}</p>
      <RobotAiFields
        config={config}
        settings={settings}
        disabled={saving}
        onChange={(value) => {
          setConfig(value);
          setStatus("");
        }}
      />
      {status && <p role="status">{status}</p>}
      <div className={styles.actions}>
        <button
          disabled={!changed || saving}
          onClick={() => {
            release();
            setConfig(structuredClone(saved));
            setStatus("已取消本次 AI 配置修改。");
          }}
        >
          取消修改
        </button>
        <button
          className={styles.primary}
          disabled={!changed || !!error || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(config);
              release();
            } catch (failure) {
              setStatus(
                failure instanceof Error
                  ? failure.message
                  : "保存失败，请重试。",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>
    </section>
  );
}
