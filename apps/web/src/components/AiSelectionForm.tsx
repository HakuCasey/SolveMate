import { useDraftBackup } from "../refresh/drafts";
import { useEditValue } from "../refresh/useEditRevision";
import { useState } from "react";
import type { Robot, RobotAiDefaults } from "@solvemate/contracts";
import type { AiSettings } from "../ai/local-api";
import { robotAiError } from "../ai/robot-config";
import { AiSelectionFields } from "./AiSelectionFields";
import styles from "./AiSettings.module.css";

export function AiSelectionForm({
  robot,
  scopeId,
  saved,
  settings,
  onSave,
}: {
  robot: Robot;
  scopeId: string;
  saved: RobotAiDefaults;
  settings: AiSettings | null;
  onSave: (config: RobotAiDefaults) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    value: RobotAiDefaults;
    baseline: RobotAiDefaults;
  } | null>(null);
  const config = draft ? draft.value : saved;
  const check = useEditValue(draft ? draft.baseline : saved, saved, scopeId);
  function setConfig(value: RobotAiDefaults) {
    setDraft({
      value,
      baseline: draft ? draft.baseline : structuredClone(saved),
    });
  }
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(saved) !== JSON.stringify(config);
  const release = useDraftBackup(
    `ai-selection:${scopeId}`,
    `${robot.name}的 AI 选择草稿`,
    config,
    changed,
  );
  const error = robotAiError(config, settings);
  return (
    <section className={styles.settings} aria-label="AI 选择">
      <p className={styles.hint}>{robot.name}</p>
      <AiSelectionFields
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
            setDraft(null);
            check.accept(saved);
            setStatus("已取消本次 AI 选择修改。");
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
              check();
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
          {saving ? "保存中…" : "保存选择"}
        </button>
      </div>
    </section>
  );
}
