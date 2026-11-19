import { SidebarToggle } from "./SidebarLayout";
import { useEffect, useState } from "react";
import { ContextMenu } from "radix-ui";
import {
  BookOpen,
  ChevronRight,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  Subject,
  Material,
  MaterialLocation,
  Question,
} from "@solvemate/contracts";
import { MaterialActions } from "../materials/MaterialActions";
import menu from "../materials/MaterialActions.module.css";
import { materialApi } from "../materials/api";
import { MaterialUploadDialog } from "../materials/MaterialUploadDialog";
import type { SubjectAction } from "./SubjectDialog";
import type { SubjectDirectory } from "../state/subjects";
import type { PersonalMaterials } from "../materials/useMaterials";
import { materialsInCourse, type LibraryScope } from "../reading/library";
import { useSaveFeedback } from "./SaveFeedback";
import { dataRefresh } from "../refresh/coordinator";
import paneHeader from "../components/PaneHeader.module.css";
import styles from "./SubjectContentList.module.css";

export function SubjectContentList({
  scope,
  directory,
  onCreateSubject,
  onUploaded,
  library,
  materialSelection,
  onOpenMaterial,
  subjectPicker,
  pickerTitle,
}: {
  scope: LibraryScope;
  directory: SubjectDirectory;
  onCreateSubject: (title: string) => Promise<Subject>;
  onUploaded: (courseId: string | null) => void;
  library: PersonalMaterials;
  materialSelection: MaterialLocation | null;
  onOpenMaterial: (location: MaterialLocation) => void;
  subjectPicker?: {
    onChange: (subjectId: string | null) => void;
    onKindChange?: (kind: LibraryScope["kind"]) => void;
    onSubjectAction?: (action: SubjectAction) => void;
  };
  pickerTitle?: string;
}) {
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const showFeedback = useSaveFeedback();
  const activeSubjects = directory.active;
  const subject = activeSubjects.find((item) => item.id === scope.courseId);
  const questions = scope.kind === "questions";
  const scoped = materialsInCourse(library.items, scope.courseId, directory);
  const files = questions
    ? []
    : scoped.filter((item) => item.kind === "textbooks");
  const groups = questions
    ? scoped.filter((item) => item.kind === "questions")
    : [];
  const groupKey = JSON.stringify(
    groups.map((item) => [item.id, item.currentVersion]),
  );
  const [questionSets, setQuestionSets] = useState<{
    key: string;
    items: { materialId: string; question: Question }[];
  }>({ key: "", items: [] });
  useEffect(() => {
    let alive = true;
    void Promise.all(
      (JSON.parse(groupKey) as [string, string][]).map(
        async ([materialId, contentVersion]) =>
          (await materialApi.questions({ materialId, contentVersion })).map(
            (question) => ({ materialId, question }),
          ),
      ),
    )
      .then((values) => {
        if (alive) setQuestionSets({ key: groupKey, items: values.flat() });
      })
      .catch((error: unknown) => {
        if (alive)
          setNotice(
            error instanceof Error
              ? error.message
              : "题目读取失败，请刷新列表。",
          );
      });
    return () => {
      alive = false;
    };
  }, [groupKey]);
  const items =
    questionSets.key === groupKey
      ? questionSets.items.flatMap((item) => {
          const material = groups.find(
            (material) => material.id === item.materialId,
          );
          return material ? [{ material, question: item.question }] : [];
        })
      : [];
  const count = files.length + items.length;
  function chooseFiles(values: File[]) {
    if (!values.length) return;
    setNotice("");
    setPendingFiles(values);
  }
  async function refreshList() {
    if (refreshing) return;
    setRefreshing(true);
    setNotice("");
    try {
      if (!(await dataRefresh.refresh(["records", "content"], true))) {
        setNotice("无法刷新资料列表，请重试。");
        return;
      }
      const result = await library.refresh();
      // 部分记录无法读取或缓存失败时，由列表显示具体说明，不提示全部成功。
      if (result && !result.warning) showFeedback("资料列表已刷新");
    } finally {
      setRefreshing(false);
    }
  }
  function openFile(item: Material) {
    onOpenMaterial(
      materialSelection?.materialId === item.id &&
        materialSelection.contentVersion === item.currentVersion
        ? materialSelection
        : {
            materialId: item.id,
            contentVersion: item.currentVersion,
            pageNumber: 1,
          },
    );
  }
  return (
    <section
      className={`${styles.library} ${subjectPicker ? styles.pickerLibrary : ""}`}
      aria-label={questions ? "题目列表" : "学习资料列表"}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          if (!questions) setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (questions) setNotice("题目暂不支持自定义上传。");
        else if (!library.busy)
          chooseFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {pickerTitle && (
        <header className={styles.pickerTitle}>
          <SidebarToggle />
          <BookOpen className={paneHeader.titleIcon} aria-hidden="true" />
          <h1>{pickerTitle}</h1>
        </header>
      )}
      {subjectPicker && (
        <nav className={styles.subjectRail} aria-label="学科">
          <div className={styles.subjectRailItems}>
            {activeSubjects.map((item) => (
              <ContextMenu.Root key={item.id}>
                <ContextMenu.Trigger asChild>
                  <button
                    aria-current={
                      item.id === scope.courseId ? "true" : undefined
                    }
                    onClick={() => subjectPicker.onChange(item.id)}
                    title={item.title}
                  >
                    {item.title}
                  </button>
                </ContextMenu.Trigger>
                {subjectPicker.onSubjectAction && (
                  <ContextMenu.Portal>
                    <ContextMenu.Content
                      className={menu.menu}
                      collisionPadding={12}
                    >
                      <ContextMenu.Item
                        className={menu.menuItem}
                        onSelect={() =>
                          subjectPicker.onSubjectAction?.({
                            kind: "rename",
                            subject: item,
                          })
                        }
                      >
                        <Pencil />
                        重命名
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        className={`${menu.menuItem} ${menu.dangerText}`}
                        onSelect={() =>
                          subjectPicker.onSubjectAction?.({
                            kind: "delete",
                            subject: item,
                          })
                        }
                      >
                        <Trash2 />
                        删除
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                )}
              </ContextMenu.Root>
            ))}
            <button
              aria-current={scope.courseId === null ? "true" : undefined}
              onClick={() => subjectPicker.onChange(null)}
            >
              未分类
            </button>
          </div>
          {subjectPicker.onSubjectAction && (
            <button
              className={styles.createSubject}
              aria-label="新增学科"
              title="新增学科"
              onClick={() =>
                subjectPicker.onSubjectAction?.({ kind: "create" })
              }
            >
              <Plus />
              <span>新增学科</span>
            </button>
          )}
        </nav>
      )}
      <div className={styles.listPane}>
        <header
          className={`${styles.header} ${subjectPicker ? styles.pickerHeader : ""}`}
        >
          {subjectPicker ? (
            subjectPicker.onKindChange ? (
              <div className={styles.kindPickerRow}>
                <div className={styles.kindPicker} aria-label="资料类型">
                  <button
                    aria-pressed={!questions}
                    onClick={() => subjectPicker.onKindChange?.("textbooks")}
                  >
                    学习资料
                  </button>
                  <button
                    aria-pressed={questions}
                    onClick={() => subjectPicker.onKindChange?.("questions")}
                  >
                    题目
                  </button>
                </div>
                <small className={styles.kindCount}>
                  {count} {questions ? "道" : "份"}
                </small>
              </div>
            ) : (
              <h1 className={styles.pickerHeading}>
                <span>{questions ? "题目" : "学习资料"}</span>
                <small>
                  {count} {questions ? "道" : "份"}
                </small>
              </h1>
            )
          ) : (
            <h1 className={styles.heading}>
              <span
                className={styles.course}
                title={subject?.title ?? "未分类"}
              >
                {subject?.title ?? "未分类"}
              </span>
              <ChevronRight className={styles.separator} aria-hidden="true" />
              <span className={styles.title}>
                {questions ? "题目" : "学习资料"}
              </span>
              <span className={styles.count}>
                {count} {questions ? "道" : "份"}
              </span>
            </h1>
          )}
          <div className={styles.actions}>
            {!questions && (
              <>
                <button
                  className={styles.upload}
                  aria-label="上传资料"
                  title="上传资料"
                  disabled={!!library.busy}
                  onClick={() => {
                    setNotice("");
                    setPendingFiles([]);
                  }}
                >
                  <Upload aria-hidden="true" />
                  <span>上传资料</span>
                </button>
                <button
                  aria-label={
                    refreshing ? "正在刷新学习资料列表" : "刷新学习资料列表"
                  }
                  title={refreshing ? "正在刷新…" : "刷新资料列表"}
                  aria-busy={refreshing}
                  disabled={refreshing || !!library.busy}
                  onClick={() => void refreshList()}
                >
                  <RefreshCw
                    className={refreshing ? styles.refreshing : undefined}
                    aria-hidden="true"
                  />
                </button>
              </>
            )}
          </div>
        </header>
        {!questions && (library.error || library.busy) && (
          <p
            className={styles.notice}
            role={library.error ? "alert" : "status"}
          >
            {library.busy || library.error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <div className={styles.items}>
          {!count && (
            <div className={styles.empty}>
              {questions ? (
                <ListChecks aria-hidden="true" />
              ) : (
                <BookOpen aria-hidden="true" />
              )}
              <h2>{questions ? "本科目暂无题目" : "添加本科目的学习资料"}</h2>
              {!questions && (
                <p>上传 PDF 课本或 PPTX 课件，也可以将文件拖到这里。</p>
              )}
              {!questions && <small>单个文件最大 100 MiB</small>}
            </div>
          )}
          {files.map((item) => (
            <MaterialActions
              key={item.id}
              item={item}
              directory={directory}
              library={library}
            >
              <div className={styles.fileRow}>
                <button
                  className={styles.fileOpen}
                  onClick={() => openFile(item)}
                >
                  <span className={styles.icon}>
                    <FileText aria-hidden="true" />
                  </span>
                  <span className={styles.copy}>
                    <strong>{item.title}</strong>
                    <small>
                      {item.version.mediaType === "application/pdf"
                        ? "PDF"
                        : "PPTX"}{" "}
                      ·{" "}
                      {item.version.status === "ready"
                        ? `${item.version.pageCount} 页`
                        : item.version.status === "processing"
                          ? "正在处理"
                          : "处理失败"}
                    </small>
                    {item.version.error && (
                      <span className={styles.error}>{item.version.error}</span>
                    )}
                  </span>
                </button>
                <div className={styles.fileActions}>
                  {item.version.status === "failed" && (
                    <button onClick={() => void library.retry(item.id)}>
                      重试
                    </button>
                  )}
                </div>
              </div>
            </MaterialActions>
          ))}
          {items.map(({ material, question: item }) => (
            <MaterialActions
              key={`${material.id}:${item.id}`}
              item={material}
              library={library}
              directory={directory}
            >
              <button
                key={`${material.id}:${item.id}`}
                className={styles.courseItem}
                onClick={() =>
                  onOpenMaterial({
                    materialId: material.id,
                    contentVersion: material.currentVersion,
                    questionId: item.id,
                  })
                }
              >
                <span className={styles.icon}>
                  <ListChecks aria-hidden="true" />
                </span>
                <span className={styles.copy}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.id} · {item.topic} · {item.difficulty}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </MaterialActions>
          ))}
        </div>
      </div>
      {pendingFiles && (
        <MaterialUploadDialog
          initialFiles={pendingFiles}
          initialSubjectId={scope.courseId}
          directory={directory}
          library={library}
          onClose={() => setPendingFiles(null)}
          onCreateSubject={onCreateSubject}
          onComplete={onUploaded}
        />
      )}
      {dragging && (
        <div className={styles.drop}>松开以添加本科目的学习资料</div>
      )}
    </section>
  );
}
