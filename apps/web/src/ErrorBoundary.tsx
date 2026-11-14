import { Component, type ReactNode } from "react";
import { logError } from "./logger";
import { StartupUpdate } from "./components/StartupUpdate";
import styles from "./App.module.css";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    logError("Failed to display the learning workspace.", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // 渲染失败时保留数据库，避免把无法显示的记录当作空数据重新初始化。
    return (
      <main className={styles.loading}>
        <h1>SolveMate</h1>
        <p role="alert">
          页面无法显示当前记录，原有本地数据未被清除。请重新打开应用后重试。
        </p>
        <button onClick={() => window.location.reload()}>重新打开</button>
        <StartupUpdate />
      </main>
    );
  }
}
