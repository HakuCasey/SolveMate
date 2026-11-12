import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./PaneHeader.module.css";

/** 列表与正文共用标题栏，数量、来源和操作仍由各页面提供。 */
export function PaneHeader({
  icon: Icon,
  title,
  detail,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <span className={styles.icon}>
        <Icon aria-hidden="true" />
      </span>
      <div className={styles.content}>
        <h2 title={title}>{title}</h2>
        {detail && <div className={styles.detail}>{detail}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
