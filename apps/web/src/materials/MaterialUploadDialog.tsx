import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Plus,
  Upload,
  X,
} from "lucide-react";
import type { Subject } from "@solvemate/contracts";
import { SettingsSelect } from "../components/SettingsSelect";
import type { SubjectDirectory } from "../state/subjects";
import type { PersonalMaterials } from "./useMaterials";
import {
  updateUpload,
  uploadEntryState,
  type UploadEntry,
} from "./upload-progress";
import { uploadFileError } from "./upload";
import styles from "./MaterialUploadDialog.module.css";

const unclassified = "__unclassified__";
const newSubject = "__new__";

export function MaterialUploadDialog({
  initialFiles,
  initialSubjectId,
  directory,
  library,
  onClose,
  onCreateSubject,
  onComplete,
}: {
  initialFiles: File[];
  initialSubjectId: string | null;
  directory: SubjectDirectory;
  library: PersonalMaterials;
  onClose: () => void;
  onCreateSubject: (title: string) => Promise<Subject>;
  onComplete: (subjectId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState(initialFiles);
  const [step, setStep] = useState(1);
  const [subjectId, setSubjectId] = useState(initialSubjectId ?? unclassified);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const results = entries.map((entry) => ({
    entry,
    ...uploadEntryState(entry, library.items),
  }));
  const finished = results.filter(
    (item) => item.phase === "ready" || item.phase === "failed",
  ).length;
  const failures = results.filter((item) => item.phase === "failed");
  const uploadFailures = results.filter(
    (item) => item.entry.phase === "failed",
  );
  const processing = results.some((item) => item.phase === "processing");
  const invalid = files.some((file) => uploadFileError(file));
  function addFiles(values: File[]) {
    setFiles((previous) => [
      ...previous,
      ...values.filter(
        (file) =>
          !previous.some(
            (old) =>
              old.name === file.name &&
              old.size === file.size &&
              old.lastModified === file.lastModified,
          ),
      ),
    ]);
    setError("");
  }
  async function performUpload(values: File[], id: string | null) {
    setSaving(true);
    setError("");
    setEntries((previous) => [
      ...previous.filter((item) => !values.includes(item.file)),
      ...values.map((file) => ({
        file,
        loaded: 0,
        total: file.size,
        phase: "queued" as const,
      })),
    ]);
    setStep(3);
    try {
      await library.importFiles(values, id, (event) =>
        setEntries((previous) => updateUpload(previous, event)),
      );
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "资料未能上传，请重试。";
      setError(message);
      setEntries((previous) =>
        previous.map((entry) =>
          values.includes(entry.file) && entry.phase !== "uploaded"
            ? { ...entry, phase: "failed", error: message }
            : entry,
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  async function submit() {
    if (saving || !files.length || invalid) return;
    setSaving(true);
    setError("");
    try {
      let target = subjectId;
      if (target === newSubject) {
        const created = await onCreateSubject(name);
        target = created.id;
        setSubjectId(target);
      }
      await performUpload(files, target === unclassified ? null : target);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "资料未能上传，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (step === 1 && !saving)
              addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className={styles.heading}>
            <div>
              <Dialog.Title>上传资料</Dialog.Title>
              <Dialog.Description>
                {step === 3
                  ? "上传与处理完成后，资料即可阅读。"
                  : "先选择文件，再确定所属学科和内容类型。"}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className={styles.close}
              disabled={saving}
              aria-label={step === 3 ? "关闭上传进度" : "取消上传"}
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <ol className={styles.steps} aria-label="上传步骤">
            <li data-current={step === 1}>
              {step >= 2 ? <Check aria-hidden="true" /> : <span>1</span>}
              选择资料
            </li>
            <li className={styles.stepDivider} aria-hidden="true">
              <ChevronRight />
            </li>
            <li data-current={step === 2}>
              {step === 3 ? <Check aria-hidden="true" /> : <span>2</span>}
              学科与类型
            </li>
            <li className={styles.stepDivider} aria-hidden="true">
              <ChevronRight />
            </li>
            <li data-current={step === 3}>
              <span>3</span>上传与处理
            </li>
          </ol>
          {step === 1 ? (
            <div className={styles.fileStep}>
              <button
                className={styles.picker}
                onClick={() => input.current?.click()}
              >
                <Upload aria-hidden="true" />
                <span>选择文件或拖入这里</span>
                <small>PDF / PPTX · 单个文件最大 100 MiB</small>
              </button>
              <input
                ref={input}
                hidden
                type="file"
                multiple
                accept=".pdf,.pptx"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <ul className={styles.files} aria-label="待上传文件">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <FileText aria-hidden="true" />
                    <div>
                      <strong>{file.name}</strong>
                      <small>{(file.size / 1024 / 1024).toFixed(1)} MiB</small>
                      {uploadFileError(file) && (
                        <span className={styles.error}>
                          {uploadFileError(file)}
                        </span>
                      )}
                    </div>
                    <button
                      aria-label={`移除文件：${file.name}`}
                      onClick={() =>
                        setFiles((previous) =>
                          previous.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : step === 2 ? (
            <div className={styles.options}>
              <p className={styles.summary}>已选择 {files.length} 个文件</p>
              <SettingsSelect
                label="所属学科"
                value={subjectId}
                disabled={saving}
                onValueChange={(value) => {
                  setSubjectId(value);
                  setError("");
                }}
                options={[
                  { value: unclassified, name: "未分类" },
                  ...directory.active.map((item) => ({
                    value: item.id,
                    name: item.title,
                  })),
                  { value: newSubject, name: "＋ 新建学科", emphasized: true },
                ]}
              />
              {subjectId === newSubject && (
                <label className={styles.newSubject}>
                  <span>
                    <Plus aria-hidden="true" />
                    新学科名称
                  </span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={saving}
                    placeholder="例如：大学物理"
                    maxLength={80}
                  />
                </label>
              )}
              <fieldset className={styles.types} disabled={saving}>
                <legend>内容类型</legend>
                <label className={styles.type} data-selected>
                  <input
                    type="radio"
                    name="material-type"
                    value="materials"
                    checked
                    readOnly
                  />
                  <span>学习资料</span>
                </label>
                <label className={styles.type} data-disabled>
                  <input
                    type="radio"
                    name="material-type"
                    value="questions"
                    disabled
                    aria-describedby="question-upload-reason"
                  />
                  <span>
                    题目
                    <small id="question-upload-reason">
                      不符合题目格式要求
                    </small>
                  </span>
                </label>
              </fieldset>
            </div>
          ) : (
            <section
              className={styles.progressSection}
              aria-label="上传与处理进度"
            >
              <div className={styles.progressHeading} role="status">
                <strong>
                  已处理 {finished} / {entries.length} 份
                </strong>
                {failures.length > 0 && (
                  <span className={styles.error}>{failures.length} 份失败</span>
                )}
              </div>
              <progress
                max={Math.max(entries.length, 1)}
                value={finished}
                aria-label="资料处理总进度"
              />
              <ul className={styles.files}>
                {results.map(
                  ({ entry, phase, label, error: failure, record }, index) => (
                    <li key={index}>
                      <FileText aria-hidden="true" />
                      <div>
                        <strong>{entry.file.name}</strong>
                        <span role="status">{label}</span>
                        {entry.phase === "uploading" && (
                          <>
                            <progress
                              max={entry.total || 1}
                              value={entry.loaded}
                              aria-label={`${entry.file.name} 上传进度`}
                            />
                            <small>
                              {Math.round(
                                (entry.loaded / Math.max(entry.total, 1)) * 100,
                              )}
                              % · {(entry.loaded / 1024 / 1024).toFixed(1)} /{" "}
                              {(entry.total / 1024 / 1024).toFixed(1)} MiB
                            </small>
                          </>
                        )}
                        {phase === "processing" && (
                          <progress
                            aria-label={`${entry.file.name} 处理进度`}
                          />
                        )}
                        {failure && (
                          <span role="alert" className={styles.error}>
                            {failure}
                          </span>
                        )}
                        {record?.version.status === "failed" && (
                          <button onClick={() => void library.retry(record.id)}>
                            重试处理
                          </button>
                        )}
                      </div>
                    </li>
                  ),
                )}
              </ul>
              {library.error && (
                <p className={styles.error} role="alert">
                  {library.error}
                  <button onClick={() => void library.refresh()}>
                    刷新处理进度
                  </button>
                </p>
              )}
              {processing && !saving && (
                <small>
                  可关闭窗口，资料会继续处理；进度也会显示在资料列表中。
                </small>
              )}
            </section>
          )}
          {saving && step !== 3 && (
            <p className={styles.notice} role="status">
              正在保存学科…
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            {step === 3 ? (
              <button disabled={saving} onClick={onClose}>
                关闭窗口
              </button>
            ) : step === 2 ? (
              <button
                disabled={saving}
                onClick={() => {
                  setStep(1);
                  setError("");
                }}
              >
                <ArrowLeft aria-hidden="true" />
                上一步
              </button>
            ) : (
              <Dialog.Close>取消</Dialog.Close>
            )}
            {step === 3 ? (
              uploadFailures.length ? (
                <div className={styles.retryActions}>
                  <button
                    disabled={saving}
                    onClick={() => {
                      setFiles(uploadFailures.map((item) => item.entry.file));
                      setEntries([]);
                      setStep(2);
                      setError("");
                    }}
                  >
                    重新选择学科
                  </button>
                  <button
                    className={styles.primary}
                    disabled={saving}
                    onClick={() =>
                      void performUpload(
                        uploadFailures.map((item) => item.entry.file),
                        subjectId === unclassified ? null : subjectId,
                      )
                    }
                  >
                    重试上传
                  </button>
                </div>
              ) : (
                <button
                  className={styles.primary}
                  disabled={saving || processing || failures.length > 0}
                  onClick={() => {
                    onComplete(subjectId === unclassified ? null : subjectId);
                    onClose();
                  }}
                >
                  {saving ? "正在上传…" : processing ? "正在处理…" : "完成"}
                </button>
              )
            ) : step === 1 ? (
              <button
                className={styles.primary}
                disabled={!files.length || invalid}
                onClick={() => {
                  setStep(2);
                  setError("");
                }}
              >
                下一步
                <ChevronRight aria-hidden="true" />
              </button>
            ) : (
              <button
                className={styles.primary}
                disabled={saving || (subjectId === newSubject && !name.trim())}
                onClick={() => void submit()}
              >
                {saving ? "正在上传…" : "开始上传"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
