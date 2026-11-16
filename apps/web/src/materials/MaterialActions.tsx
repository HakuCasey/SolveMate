import { useState, type ReactElement } from "react";
import type { Material } from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";
import { materialCourse } from "../reading/library";
import { useEditRevision } from "../refresh/useEditRevision";
import type { PersonalMaterials } from "./useMaterials";
import {
  MaterialActionMenu,
  MaterialActionDialog,
  type MaterialAction,
} from "./MaterialActionControls";

export function MaterialActions({
  item,
  directory,
  library,
  children,
}: {
  item: Material;
  directory: SubjectDirectory;
  library: PersonalMaterials;
  children: ReactElement;
}) {
  // 打开窗口时保留修订号，后台处理或其他页面的更新不能绕过冲突检查。
  const [action, setAction] = useState<{
    kind: MaterialAction;
    item: Material;
  } | null>(null);
  return (
    <>
      <MaterialActionMenu
        listed={item.deletedAt == null}
        unit={item.kind === "questions" ? "题目集" : "资料"}
        disabled={!!action}
        onAction={(kind) => setAction({ kind, item })}
      >
        {children}
      </MaterialActionMenu>
      {action && (
        <SavedMaterialDialog
          action={action}
          directory={directory}
          library={library}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

function SavedMaterialDialog({
  action,
  directory,
  library,
  onClose,
}: {
  action: { kind: MaterialAction; item: Material };
  directory: SubjectDirectory;
  library: PersonalMaterials;
  onClose: () => void;
}) {
  const getRevision = useEditRevision(
    action.item,
    library.items.find(
      (item) => item.id === action.item.id && item.deletedAt == null,
    ),
  );
  return (
    <MaterialActionDialog
      unit={action.item.kind === "questions" ? "题目集" : "资料"}
      action={action.kind}
      id={action.item.id}
      initialTitle={action.item.title}
      initialSubjectId={materialCourse(action.item, directory)}
      directory={directory}
      onClose={onClose}
      onSubmit={async (title, subjectId) => {
        const item = { ...action.item, revision: getRevision() };
        if (action.kind === "rename") await library.rename(item, title);
        else if (action.kind === "move")
          await library.assignCourse(item, subjectId);
        else await library.remove(item);
      }}
    />
  );
}
