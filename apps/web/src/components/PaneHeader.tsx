import { SidebarToggle } from "./SidebarLayout";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./PaneHeader.module.css";

/** 列表与正文共用标题栏，数量、来源和操作仍由各页面提供。 */
export function PaneHeader({
  icon: Icon,
  title,
  detail,
  actions,
  sidebarToggle,
}: {
  icon: LucideIcon;
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
  sidebarToggle?: boolean;
}) {
  return (
    <header className={styles.header}>
      {sidebarToggle && <SidebarToggle />}
      <Icon className={styles.titleIcon} aria-hidden="true" />
      <div className={styles.content}>
        <h2 title={title}>{title}</h2>
        {detail && <div className={styles.detail}>{detail}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
