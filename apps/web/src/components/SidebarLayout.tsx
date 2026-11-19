import { createContext, useContext, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import styles from "./Sidebar.module.css";

const sidebarPreference = "solvemate.sidebarCollapsed";
const Layout = createContext<{
  collapsed: boolean;
  toggleSidebar: () => void;
} | null>(null);

export function SidebarLayout({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarPreference) === "true";
    } catch {
      return false;
    }
  });

  function toggleSidebar() {
    setCollapsed(!collapsed);
    try {
      window.localStorage.setItem(sidebarPreference, String(!collapsed));
    } catch {
      // 浏览器禁用本地存储时，仍可在当前窗口切换布局。
    }
  }

  return (
    <Layout.Provider value={{ collapsed, toggleSidebar }}>
      <div className={className}>{children}</div>
    </Layout.Provider>
  );
}

export function useSidebarLayout() {
  const value = useContext(Layout);
  if (!value) throw new Error("SidebarLayout is required.");
  return value;
}

export function SidebarToggle() {
  const { collapsed, toggleSidebar } = useSidebarLayout();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "展开侧栏" : "收起侧栏";
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={label}
      title={label}
      aria-controls="main-sidebar"
      aria-expanded={!collapsed}
      onClick={toggleSidebar}
    >
      <Icon className={styles.toggleIcon} aria-hidden="true" />
    </button>
  );
}
