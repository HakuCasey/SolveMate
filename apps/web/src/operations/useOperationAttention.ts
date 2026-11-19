import { useEffect, useSyncExternalStore } from "react";
import { operations } from "./store";
import { retainOperationDiagnostics } from "./diagnostics";

const hasFailures = () => operations.snapshot().failures.length > 0;

export function useOperationAttention() {
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void retainOperationDiagnostics().then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  return useSyncExternalStore(operations.subscribe, hasFailures, hasFailures);
}
