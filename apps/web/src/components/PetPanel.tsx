import { useState } from "react";
import { PawPrint, Pencil } from "lucide-react";
import { maxPetNameLength } from "@solvemate/contracts";
import { PopoverPanel } from "./PopoverPanel";
import { RenameDialog } from "./RenameDialog";
import styles from "./Sidebar.module.css";

export function PetPanel({
  name,
  onRename,
}: {
  name: string | null;
  onRename: (name: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <PopoverPanel
      title="虚拟宠物"
      icon={PawPrint}
      side="right"
      align="start"
      width={220}
      padding={12}
      closeLabel="关闭宠物状态"
      className={styles.popover}
      onInteractOutside={(event) => {
        if (editing) event.preventDefault();
      }}
    >
      {name === null ? (
        <p className={styles.petNote}>领养宠物即可点亮爪印。</p>
      ) : (
        <>
          <div className={styles.petName}>
            <span title={name}>{name}</span>
            <button
              type="button"
              aria-label="修改宠物名称"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} />
            </button>
          </div>
          {editing && (
            <RenameDialog
              name={name}
              maxLength={maxPetNameLength}
              onSave={onRename}
              onClose={() => setEditing(false)}
            />
          )}
          <button className={styles.petShow} type="button" disabled>
            显示宠物
          </button>
          <hr className={styles.accountDivider} />
          <div className={styles.petActions}>
            {["投喂", "玩耍"].map((action) => (
              <button type="button" disabled key={action}>
                {action}
              </button>
            ))}
          </div>
        </>
      )}
      <small className={styles.petNote}>暂未提供宠物功能。</small>
    </PopoverPanel>
  );
}
