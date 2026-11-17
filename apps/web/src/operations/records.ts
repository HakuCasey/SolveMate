import type { AppData } from "@solvemate/contracts";
import { dataEqual } from "../refresh/merge";
import type { Operation } from "./store";

/** 从统一记录中的实际变更识别对象；不把草稿输入和阅读位置更新当成已提交操作。 */
export function recordOperation(
  before: AppData | null,
  after: AppData,
): Operation | null {
  if (!before) return null;
  const collections = [
    ["notes", "笔记", before.noteLibrary?.notes, after.noteLibrary?.notes],
    [
      "notebooks",
      "笔记本",
      before.noteLibrary?.notebooks,
      after.noteLibrary?.notebooks,
    ],
    ["robots", "机器人配置", before.robots, after.robots],
    ["subjects", "学科", before.subjects, after.subjects],
    ["conversations", "对话", before.conversations, after.conversations],
  ] as const;
  for (const [kind, label, oldItems = [], items = []] of collections) {
    if (dataEqual(oldItems, items)) continue;
    const previous = new Map(oldItems.map((item) => [item.id, item]));
    const added = items.find((item) => !previous.has(item.id));
    const removed = oldItems.find(
      (item) => !items.some((next) => next.id === item.id),
    );
    const changed = items.find(
      (item) => !dataEqual(previous.get(item.id), item),
    );
    const id = (added ?? removed ?? changed)?.id;
    const old = id ? previous.get(id) : undefined;
    const fields = changed as
      | {
          title?: string;
          name?: string;
          deletedAt?: number | null;
          deleted?: boolean;
          status?: string;
          notebookId?: string;
          tagIds?: string[];
          messages?: unknown[];
        }
      | undefined;
    const oldFields = old as typeof fields;
    const action = added
      ? "创建"
      : removed ||
          fields?.deleted ||
          fields?.deletedAt != null ||
          fields?.status === "deleted"
        ? "删除"
        : oldFields &&
            (fields?.title !== oldFields.title ||
              fields?.name !== oldFields.name)
          ? "重命名"
          : fields?.status === "archived" && oldFields?.status !== "archived"
            ? "归档"
            : oldFields?.status === "archived" && fields?.status === "active"
              ? "移回进行中："
              : fields?.notebookId !== oldFields?.notebookId
                ? "更换笔记本："
                : !dataEqual(fields?.tagIds, oldFields?.tagIds)
                  ? "修改标签："
                  : kind === "robots"
                    ? "保存"
                    : "更新";
    return {
      key: `records:${kind}:${id ?? "all"}`,
      label:
        action === "移回进行中："
          ? "将对话移回进行中"
          : action === "更换笔记本："
            ? "更换笔记所属的笔记本"
            : action === "修改标签："
              ? `修改${label}标签`
              : `${action}${label}`,
      targetId: id,
      targetName:
        ((added ?? removed ?? changed) as { title?: string; name?: string })
          ?.title ?? ((added ?? removed ?? changed) as { name?: string })?.name,
    };
  }
  if (!dataEqual(before.settings, after.settings))
    return { key: "records:settings", label: "修改显示设置" };
  if (before.defaultRobotId !== after.defaultRobotId)
    return { key: "records:default-robot", label: "设置默认机器人" };
  if (!dataEqual(before.questionResearch?.tools, after.questionResearch?.tools))
    return { key: "records:tools", label: "保存教研工具" };
  return null;
}
