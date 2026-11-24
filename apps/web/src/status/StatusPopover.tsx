import { PopoverPanel } from "../components/PopoverPanel";
import { Children, type ReactNode } from "react";
import { CloudDownload, LoaderCircle, MessagesSquare } from "lucide-react";
import { Popover } from "radix-ui";
import styles from "./StatusBar.module.css";

export type StatusTone = "neutral" | "active" | "ready" | "danger";

const categoryIcons = {
  应用更新: CloudDownload,
  对话状态: MessagesSquare,
};

/** 各项共用状态入口与详情样式；业务状态和操作仍由各自模块提供。 */
export function StatusPopover({
  category,
  value,
  status = value,
  tone = "neutral",
  busy = false,
  open,
  onOpenChange,
  action,
  children,
}: {
  category: keyof typeof categoryIcons;
  value: string;
  status?: string;
  tone?: StatusTone;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const CategoryIcon = categoryIcons[category];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className={styles.item}
        data-tone={tone}
        aria-label={`${category}：${value}`}
        title={`${category}：${value}`}
      >
        {busy && category === "对话状态" ? (
          <LoaderCircle className={styles.spinner} aria-hidden="true" />
        ) : (
          <CategoryIcon
            aria-hidden="true"
            className={busy ? styles.busy : undefined}
          />
        )}
        <span role="status" aria-atomic="true">
          {value}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          title={category}
          icon={CategoryIcon}
          width={240}
          padding={12}
          closeLabel={`关闭${category}详情`}
          className={styles.popover}
          data-tone={tone}
          side="right"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label={`${category}详情`}
        >
          <div className={styles.summary}>
            <p className={styles.currentStatus}>{status}</p>
            {action}
          </div>
          {Children.toArray(children).length > 0 && (
            <div className={styles.body}>{children}</div>
          )}
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
