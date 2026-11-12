import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Material } from "@solvemate/contracts";
import { materialApi } from "./api";
import type { SubjectDirectory } from "../state/subjects";
import { createMaterialOperations } from "./operations";
import { createMaterialQuery } from "./query";

export function useMaterials(readSubjects: () => SubjectDirectory) {
  const [items, setItems] = useState<Material[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const importing = useRef(false);
  const [query] = useState(() =>
    createMaterialQuery(
      materialApi.list,
      (next) => {
        setItems(next.items);
        setError(next.warning);
      },
      setError,
    ),
  );
  const refresh = query.refresh;
  const applyRecord = useCallback(
    (record: Material) => {
      query.invalidate();
      setItems((previous) => [
        previous.find(
          (item) => item.id === record.id && item.revision > record.revision,
        ) ?? record,
        ...previous.filter((item) => item.id !== record.id),
      ]);
    },
    [query],
  );
  const operations = useMemo(
    () =>
      createMaterialOperations({
        readSubjects,
        importFile: materialApi.import,
        assignCourse: materialApi.assignCourse,
      }),
    [readSubjects],
  );
  useEffect(() => {
    let alive = true;
    void query.restoreCached(materialApi.cached).then(async () => {
      if (alive) await refresh();
    });
    return () => {
      alive = false;
      query.invalidate();
    };
  }, [query, refresh]);
  const processing = items.some((item) => item.version.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [processing, refresh]);
  async function importFiles(files: File[], courseId: string | null) {
    if (importing.current) throw new Error("正在上传另一批资料，请稍后重试。");
    importing.current = true;
    setError("");
    query.invalidate();
    try {
      const result = await operations.importFiles(
        files,
        courseId,
        (file) => {
          query.invalidate();
          setBusy(`正在保存 ${file.name}…`);
        },
        applyRecord,
      );
      await refresh();
      if (result.failed.length)
        setError((previous) =>
          [
            previous,
            ...result.failed.map(
              ({ file, message }) => `${file.name}：${message}`,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
        );
      return result;
    } finally {
      importing.current = false;
      setBusy("");
    }
  }
  async function retry(id: string) {
    try {
      query.invalidate();
      const record = await materialApi.retry(id);
      applyRecord(record);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "重试处理失败。");
    }
  }
  async function updateRecord(change: () => Promise<Material>) {
    query.invalidate();
    try {
      const record = await change();
      applyRecord(record);
      const warning = await materialApi.remember(record);
      const next = await refresh();
      if (!next) setError(warning || "资料已保存，列表尚未刷新，请重新读取。");
      return record;
    } catch (failure) {
      // 保存冲突后读取最新记录，用户关闭窗口再操作即可使用最新修订号。
      await refresh();
      throw failure;
    }
  }
  const assignCourse = (item: Material, courseId: string | null) =>
    updateRecord(() => operations.assignCourse(item, courseId, applyRecord));
  const rename = (item: Material, title: string) =>
    updateRecord(() => materialApi.rename(item, title));
  const remove = (item: Material) =>
    updateRecord(() => materialApi.remove(item));
  return {
    items,
    error,
    busy,
    refresh,
    importFiles,
    retry,
    assignCourse,
    rename,
    remove,
  };
}
export type PersonalMaterials = ReturnType<typeof useMaterials>;
