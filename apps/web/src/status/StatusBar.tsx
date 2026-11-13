import type { ReactNode } from "react";
import styles from "./StatusBar.module.css";
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <footer className={styles.bar} aria-label="状态栏">
      {children}
    </footer>
  );
}
