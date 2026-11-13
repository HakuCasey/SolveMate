import type { NoteLibrary } from "@solvemate/contracts";
import type { NoteDestination } from "../state/notes";
import { SettingsSelect } from "./SettingsSelect";
import styles from "./NoteManagement.module.css";

const createOption = "__create_notebook__";

/** 记录笔记和转移笔记共用目标选择；这里只收集意图，保存时再原子创建笔记本。 */
export function NotebookDestinationSelect({
  library,
  value,
  onChange,
  disabled = false,
  label = "笔记本",
}: {
  library: NoteLibrary;
  value: NoteDestination;
  onChange: (value: NoteDestination) => void;
  disabled?: boolean;
  label?: string;
}) {
  const selected = value.kind === "new" ? createOption : value.notebookId;
  return (
    <>
      <SettingsSelect
        label={label}
        value={selected}
        disabled={disabled}
        options={[
          ...(!library.notebooks.some((book) => book.id === selected) &&
          value.kind === "existing"
            ? [
                {
                  value: selected,
                  name: "原笔记本已删除，请重新选择",
                  disabled: true,
                },
              ]
            : []),
          ...library.notebooks.map((book) => ({
            value: book.id,
            name: book.title,
          })),
          { value: createOption, name: "新建笔记本", emphasized: true },
        ]}
        onValueChange={(id) =>
          onChange(
            id === createOption
              ? { kind: "new", title: "" }
              : { kind: "existing", notebookId: id },
          )
        }
      />
      {value.kind === "new" && (
        <label className={styles.name}>
          新笔记本名称
          <input
            value={value.title}
            maxLength={80}
            placeholder="例如：考前复习"
            disabled={disabled}
            onChange={(event) =>
              onChange({ kind: "new", title: event.target.value })
            }
          />
        </label>
      )}
    </>
  );
}
