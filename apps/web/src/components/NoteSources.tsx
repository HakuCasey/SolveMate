import { useState } from "react";
import { Popover } from "radix-ui";
import { Link2 } from "lucide-react";
import type {
  LearningLocation,
  Note,
  NoteOrigin,
  MessageSource,
} from "@solvemate/contracts";
import type { LearningRelations } from "../reading/relations";
import { PopoverPanel } from "./PopoverPanel";
import styles from "./NoteSources.module.css";

export function NoteSources({
  note,
  relations,
  onLocation,
  onMessage,
}: {
  note: Note;
  relations: LearningRelations;
  onLocation: (source: LearningLocation) => void;
  onMessage: (source: MessageSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const origins = note.origins;
  if (!origins.length) return null;
  function entry(origin: NoteOrigin, index: number) {
    const { label, location, message, available } =
      relations.describeOrigin(origin);
    return (
      <button
        key={index}
        type="button"
        className={styles.source}
        title={label}
        disabled={!available}
        onClick={() => {
          setOpen(false);
          if (message) onMessage(message);
          else if (location) onLocation(location);
        }}
      >
        <Link2 aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={styles.source}
        aria-label={`${note.title}的来源`}
      >
        <Link2 aria-hidden="true" />
        查看来源（{origins.length}）
      </Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          title="笔记来源"
          icon={Link2}
          width={340}
          closeLabel="关闭笔记来源"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <div className={styles.list}>{origins.map(entry)}</div>
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
