import { useState, type ReactElement } from "react";
import { ContextMenu } from "radix-ui";
import { Pencil, Trash2 } from "lucide-react";
import type { TeachingTool } from "@solvemate/contracts";
import { RenameDialog } from "../components/RenameDialog";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import menu from "../materials/MaterialActions.module.css";
import { toolTitle } from "./state";
import type { TeachingTools } from "./useTeachingTools";

export function TeachingToolActions({
  tool,
  tools,
  children,
  onRenamed,
  onDeleted,
}: {
  tool?: TeachingTool;
  tools: TeachingTools;
  children: ReactElement;
  onRenamed?: (name: string) => void;
  onDeleted?: () => void;
}) {
  const [action, setAction] = useState<{
    kind: "rename" | "delete";
    name: string;
  } | null>(null);
  if (!tool) return children;
  const name = toolTitle(tool);
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menu.menu} collisionPadding={12}>
            <ContextMenu.Item
              className={menu.menuItem}
              disabled={!!tools.busy}
              onSelect={() => setAction({ kind: "rename", name })}
            >
              <Pencil />
              重命名
            </ContextMenu.Item>
            <ContextMenu.Item
              className={`${menu.menuItem} ${menu.dangerText}`}
              disabled={!!tools.busy}
              onSelect={() => setAction({ kind: "delete", name })}
            >
              <Trash2 />
              删除
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {action?.kind === "rename" && (
        <RenameDialog
          name={action.name}
          maxLength={80}
          onSave={async (title) => {
            await tools.rename(tool.id, title, action.name);
            onRenamed?.(title);
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === "delete" && (
        <ConfirmDeleteDialog
          title="删除工具"
          description={`删除“${action.name}”？已有对话保留。`}
          onConfirm={async () => {
            await tools.remove(tool.id);
            onDeleted?.();
          }}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}
