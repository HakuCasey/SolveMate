import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { SaveFeedbackProvider } from "./components/SaveFeedback";
import "./styles.css";
import "katex/dist/katex.min.css";

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
