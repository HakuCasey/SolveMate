import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme } from "./theme/theme";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { SaveFeedbackProvider } from "./components/SaveFeedback";
import "./styles.css";
import "katex/dist/katex.min.css";

// 首屏使用默认主题；个人设置载入后由应用恢复已保存的明暗模式。
applyTheme(
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
);

const container = document.getElementById("root");
if (!container) throw new Error("Application root element was not found.");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <SaveFeedbackProvider>
        <App />
      </SaveFeedbackProvider>
    </ErrorBoundary>
  </StrictMode>,
);
