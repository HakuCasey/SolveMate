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
import type { MaterialImportResult } from "./operations";
import { uploadFileError } from "./upload";
import styles from "./MaterialUploadDialog.module.css";

const unclassified = "__unclassified__";
const newSubject = "__new__";

export function MaterialUploadDialog({
  initialFiles,
  initialSubjectId,
  directory,
  busy,
  onClose,
  onCreateSubject,
  onUpload,
  onComplete,
}: {
  initialFiles: File[];
  initialSubjectId: string | null;
  directory: SubjectDirectory;
  busy: string;
  onClose: () => void;
  onCreateSubject: (title: string) => Promise<Subject>;
  onUpload: (
    files: File[],
    subjectId: string | null,
  ) => Promise<MaterialImportResult>;
  onComplete: (subjectId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState(initialFiles);
  const [step, setStep] = useState(1);
  const [subjectId, setSubjectId] = useState(initialSubjectId ?? unclassified);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  async function submit() {
    if (saving || !files.length || invalid) return;
    setSaving(true);
    setError("");
    try {
      let target = subjectId;
      if (target === newSubject) {
        const created = await onCreateSubject(name);
        target = created.id;
        // 新建成功后立即保留编号，后续上传失败重试时不再重复新建学科。
        setSubjectId(target);
      }
      const id = target === unclassified ? null : target;
      const result = await onUpload(files, id);
      if (result.failed.length) {
        setFiles(result.failed.map((item) => item.file));
        const prefix = result.saved.length
          ? `已保存 ${result.saved.length} 份资料，以下文件未能上传：`
          : "以下文件未能上传：";
        setError(
          [
            prefix,
            ...result.failed.map(
              ({ file, message }) => `${file.name}：${message}`,
            ),
          ].join("\n"),
        );
        return;
      }
      onComplete(id);
      onClose();
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
                先选择文件，再确定所属学科和内容类型。
              </Dialog.Description>
            </div>
            <Dialog.Close
              className={styles.close}
              disabled={saving}
              aria-label="取消上传"
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <ol className={styles.steps} aria-label="上传步骤">
            <li data-current={step === 1}>
              {step === 2 ? <Check aria-hidden="true" /> : <span>1</span>}
              选择资料
            </li>
            <li className={styles.stepDivider} aria-hidden="true">
              <ChevronRight />
            </li>
            <li data-current={step === 2}>
              <span>2</span>学科与类型
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
          ) : (
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
          )}
          {saving && (
            <p className={styles.notice} role="status">
              {busy || "正在保存学科…"}
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            {step === 2 ? (
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
            {step === 1 ? (
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
