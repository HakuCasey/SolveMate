import type { AppData } from "@solvemate/contracts";
export interface DataConflict {
  path: string[];
  local: unknown;
  remote: unknown;
  deleted: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
// HTTP JSON 与页面对象的属性顺序可以不同，比较值时不能把字段顺序当作修改。
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((item, index) => same(item, b[index]))
    );
  if (!object(a) || !object(b)) return false;
  const left = Object.keys(a).filter((key) => a[key] !== undefined),
    right = Object.keys(b).filter((key) => b[key] !== undefined);
  return (
    left.length === right.length &&
    left.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
  );
};
const identified = (
  items: unknown[],
): items is ({ id: string } & Record<string, unknown>)[] =>
  items.every((item) => object(item) && typeof item.id === "string");

/** 只合并基线以来互不覆盖的修改；同一字段的两份修改保留给用户确认。 */
export function mergeData(base: AppData, local: AppData, remote: AppData) {
  const conflicts: DataConflict[] = [];
  function merge(
    before: unknown,
    here: unknown,
    there: unknown,
    path: string[],
  ): unknown {
    if (same(here, before) || same(here, there)) return structuredClone(there);
    if (same(there, before)) return structuredClone(here);
    const key = path.at(-1);
    if (path[0] === "readingProgress" && path.length >= 3)
      return structuredClone(here);
    if (
      ["revision", "updatedAt", "lastActivityAt"].includes(key ?? "") &&
      typeof here === "number" &&
      typeof there === "number"
    )
      return Math.max(here, there);
    if (key === "selection" || key === "materialSelection")
      return structuredClone(here);
    if (key === "status" && there === "deleted") return there;
    if (
      ["aiConfig", "aiDefaults", "binding", "snapshot", "dispatch"].includes(
        key ?? "",
      )
    ) {
      conflicts.push({
        path,
        local: structuredClone(here),
        remote: structuredClone(there),
        deleted: there === undefined,
      });
      return structuredClone(here);
    }
    if (
      object(here) &&
      object(there) &&
      (object(before) || before === undefined)
    ) {
      const result: Record<string, unknown> = {};
      for (const property of new Set([
        ...Object.keys(here),
        ...Object.keys(there),
      ])) {
        const value = merge(
          object(before) ? before[property] : undefined,
          here[property],
          there[property],
          [...path, property],
        );
        if (value !== undefined) result[property] = value;
      }
      if (
        typeof here.revision === "number" &&
        typeof there.revision === "number"
      )
        result.revision = Math.max(here.revision, there.revision) + 1;
      return result;
    }
    if (
      Array.isArray(here) &&
      Array.isArray(there) &&
      identified(here) &&
      identified(there) &&
      (before === undefined || (Array.isArray(before) && identified(before)))
    ) {
      const old = new Map((before ?? []).map((item) => [item.id, item]));
      const current = new Map(here.map((item) => [item.id, item]));
      const latest = new Map(there.map((item) => [item.id, item]));
      const result: unknown[] = [];
      for (const id of new Set([...latest.keys(), ...current.keys()])) {
        const value = merge(old.get(id), current.get(id), latest.get(id), [
          ...path,
          `@${id}`,
        ]);
        if (value !== undefined) result.push(value);
      }
      return result;
    }
    conflicts.push({
      path,
      local: structuredClone(here),
      remote: structuredClone(there),
      deleted: there === undefined,
    });
    return structuredClone(here);
  }
  const result = merge(base, local, remote, []) as AppData;
  // AI 执行按原编号与结果版本取值，持续到达的正文不成为用户编辑冲突。
  for (const conversation of result.conversations) {
    const left = local.conversations.find(
      (item) => item.id === conversation.id,
    );
    const right = remote.conversations.find(
      (item) => item.id === conversation.id,
    );
    if (!left || !right) continue;
    for (const turn of conversation.turns) {
      const a = left.turns.find((item) => item.id === turn.id),
        b = right.turns.find((item) => item.id === turn.id);
      if (!a || !b) continue;
      const selected = a.revision > b.revision ? left : right;
      const latest = selected.turns.find((item) => item.id === turn.id)!;
      Object.assign(turn, structuredClone(latest));
      conversation.messages = conversation.messages.map((message) =>
        message.turnId === turn.id && message.role === "assistant"
          ? structuredClone(
              selected.messages.find((item) => item.id === message.id) ??
                message,
            )
          : message,
      );
      for (let i = conflicts.length - 1; i >= 0; i--)
        if (
          conflicts[i].path[1] === `@${conversation.id}` &&
          (conflicts[i].path.includes(`@${turn.id}`) ||
            conversation.messages.some(
              (message) =>
                message.turnId === turn.id &&
                message.role === "assistant" &&
                conflicts[i].path.includes(`@${message.id}`),
            ))
        )
          conflicts.splice(i, 1);
    }
  }
  // 远端已删除的会话保留删除状态和历史，不能被迟到的流式结果复活。
  for (const item of remote.conversations)
    if (item.status === "deleted") {
      const index = result.conversations.findIndex(
        (other) => other.id === item.id,
      );
      if (index >= 0) result.conversations[index] = structuredClone(item);
      for (let i = conflicts.length - 1; i >= 0; i--)
        if (conflicts[i].path[1] === `@${item.id}`) conflicts.splice(i, 1);
    }
  return { data: result, conflicts };
}
export function resolveDataConflict(
  data: AppData,
  conflict: DataConflict,
  choice: "local" | "remote",
): AppData {
  if (choice === "local") return data;
  const result = structuredClone(data);
  let target: unknown = result;
  for (const part of conflict.path.slice(0, -1))
    target =
      part.startsWith("@") && Array.isArray(target)
        ? target.find((item: { id: string }) => item.id === part.slice(1))
        : (target as Record<string, unknown>)[part];
  const last = conflict.path.at(-1)!;
  if (Array.isArray(target) && last.startsWith("@")) {
    const index = target.findIndex(
      (item: { id: string }) => item.id === last.slice(1),
    );
    if (index >= 0) {
      if (conflict.remote === undefined) target.splice(index, 1);
      else target[index] = structuredClone(conflict.remote);
    }
  } else if (conflict.remote === undefined)
    delete (target as Record<string, unknown>)[last];
  else
    (target as Record<string, unknown>)[last] = structuredClone(
      conflict.remote,
    );
  return result;
}
export const dataEqual = same;

export function valueAt(data: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, part) =>
      part.startsWith("@") && Array.isArray(current)
        ? current.find((item: { id: string }) => item.id === part.slice(1))
        : object(current)
          ? current[part]
          : undefined,
    data,
  );
}

/** 再次刷新只更新冲突的比较内容，不能替用户确认；父记录删除时合并为一项冲突。 */
export function pendingConflicts(
  previous: DataConflict[],
  next: DataConflict[],
  local: AppData,
  remote: AppData,
) {
  const result = [...next];
  for (const item of previous) {
    if (
      next.some((other) =>
        other.path.every((part, index) => item.path[index] === part),
      )
    )
      continue;
    const here = valueAt(local, item.path),
      there = valueAt(remote, item.path);
    if (!same(here, there))
      result.push({
        ...item,
        local: structuredClone(here),
        remote: structuredClone(there),
        deleted: there === undefined,
      });
  }
  return result;
}
