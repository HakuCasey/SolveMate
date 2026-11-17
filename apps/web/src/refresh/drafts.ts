import { useEffect, useMemo } from "react";
import { userCache } from "../storage/local-client";

/** 只登记当前窗口中尚未提交的表单，不复制表单内容，也不写入历史草稿。 */
export class UnsavedFormStore {
  private active = new Set<string>();
  snapshot = () => ({ activeCount: this.active.size });
  set(id: string, dirty: boolean) {
    if (dirty) this.active.add(id);
    else this.active.delete(id);
  }
  clear = (id: string) => {
    this.active.delete(id);
  };
}
export const unsavedForms = new UnsavedFormStore();

export function useUnsavedForm(id: string, dirty: boolean) {
  const token = useMemo(() => `${id}:${crypto.randomUUID()}`, [id]);
  useEffect(() => {
    unsavedForms.set(token, dirty);
    return () => unsavedForms.clear(token);
  }, [token, dirty]);
  return () => unsavedForms.clear(token);
}

/** 清理已停用的表单副本；只删除旧键前缀，不触及正式记录或失败事务备份。 */
export async function removeStoredFormDrafts() {
  return userCache.records.where("key").startsWith("form-draft:").delete();
}
