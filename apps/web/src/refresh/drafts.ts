import { useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { userCache } from "../storage/local-client";
import { logError } from "../logger";
export interface FormDraft {
  id: string;
  title: string;
  value: unknown;
  updatedAt: number;
}

/** 表单草稿独立于正式查询结果；组件因记录删除而卸载时，草稿仍可查看和导出。 */
export class FormDraftStore {
  private state: { items: FormDraft[]; error: string; activeCount: number } = {
    items: [],
    activeCount: 0,
    error: "",
  };
  private active = new Set<string>();
  private listeners = new Set<() => void>();
  private writes = new Map<string, Promise<unknown>>();
  private changed = new Set<string>();
  snapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private publish(items: FormDraft[], error = this.state.error) {
    this.state = { items, error, activeCount: this.active.size };
    for (const callback of this.listeners) callback();
  }
  remember(draft: FormDraft) {
    this.changed.add(draft.id);
    const activated = !this.active.has(draft.id);
    this.active.add(draft.id);
    const previous = this.state.items.find((item) => item.id === draft.id);
    if (JSON.stringify(previous?.value) === JSON.stringify(draft.value)) {
      if (activated) this.publish(this.state.items);
      return;
    }
    this.publish([
      draft,
      ...this.state.items.filter((item) => item.id !== draft.id),
    ]);
    this.write(draft.id, () => userCache.put(`form-draft:${draft.id}`, draft));
  }
  clear = (id: string) => {
    this.changed.add(id);
    this.active.delete(id);
    this.publish(this.state.items.filter((item) => item.id !== id));
    this.write(id, () => userCache.records.delete(`form-draft:${id}`));
  };
  deactivate = (id: string) => {
    if (this.active.delete(id)) this.publish(this.state.items);
  };
  private write(id: string, action: () => Promise<unknown>) {
    const task = (this.writes.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action)
      .catch((error: unknown) => {
        logError("Failed to cache form draft.", error);
        this.publish(
          this.state.items,
          "表单输入仍在当前窗口，但草稿缓存未能写入，请保留页面或导出内容。",
        );
      });
    this.writes.set(id, task);
  }
  async restore() {
    try {
      const rows = await userCache.records
        .where("key")
        .startsWith("form-draft:")
        .toArray();
      const restored = rows
        .map((row) => row.value as FormDraft)
        .filter(
          (item) =>
            typeof item?.id === "string" &&
            typeof item.title === "string" &&
            !this.changed.has(item.id),
        );
      this.publish([
        ...this.state.items,
        ...restored.filter(
          (item) => !this.state.items.some((current) => current.id === item.id),
        ),
      ]);
    } catch (error) {
      logError("Failed to read form drafts.", error);
      this.publish(this.state.items, "历史草稿未能读取，缓存原值仍保留。");
    }
  }
}
export const formDrafts = new FormDraftStore();
export function useDraftBackup(
  id: string,
  title: string,
  value: unknown,
  dirty: boolean,
) {
  const token = useMemo(() => `${id}:${crypto.randomUUID()}`, [id]);
  const previous = useRef({ token, dirty: false });
  useEffect(() => () => formDrafts.deactivate(token), [token]);
  const serialized = JSON.stringify(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (dirty)
      formDrafts.remember({
        id: token,
        title,
        value: structuredClone(valueRef.current),
        updatedAt: Date.now(),
      });
    else if (previous.current.token === token && previous.current.dirty)
      formDrafts.clear(token);
    previous.current = { token, dirty };
  }, [token, title, serialized, dirty]);
  return () => formDrafts.clear(token);
}
export function useFormDrafts() {
  return useSyncExternalStore(
    formDrafts.subscribe,
    formDrafts.snapshot,
    formDrafts.snapshot,
  );
}
