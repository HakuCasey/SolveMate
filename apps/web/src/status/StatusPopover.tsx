import { PopoverPanel } from "../components/PopoverPanel";
import { Children, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CloudDownload, MessagesSquare, Save } from "lucide-react";
import { Popover } from "radix-ui";
import styles from "./StatusBar.module.css";

export type StatusTone = "neutral" | "active" | "ready" | "danger";

const categoryIcons = {
  记录保存: Save,
  应用更新: CloudDownload,
  对话状态: MessagesSquare,
};

/** 三列共用状态入口与详情样式；业务状态和操作仍由各自模块提供。 */
export function StatusPopover({
  category,
  value,
  status = value,
  icon: Icon,
  tone = "neutral",
  busy = false,
  open,
  onOpenChange,
  children,
}: {
  category: keyof typeof categoryIcons;
  value: string;
  status?: string;
  icon: LucideIcon;
  tone?: StatusTone;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const CategoryIcon = categoryIcons[category];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={styles.item}
        data-tone={tone}
        aria-label={`${category}：${value}`}
      >
        <Icon
          aria-hidden="true"
          className={busy ? styles.spinning : undefined}
        />
        <span role="status" aria-atomic="true">
          {value}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          title={category}
          icon={CategoryIcon}
          closeLabel={`关闭${category}详情`}
          className={styles.popover}
          data-tone={tone}
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label={`${category}详情`}
        >
          <p className={styles.currentStatus}>{status}</p>
          {Children.toArray(children).length > 0 && (
            <div className={styles.body}>{children}</div>
          )}
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
