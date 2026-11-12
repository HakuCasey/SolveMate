import { useCallback, useState } from "react";
import type { DraftReference } from "./reference";
import type { ReadingSelection, MaterialLocation } from "@solvemate/contracts";
import {
  updateReadingDocument,
  updateReadingPosition,
  updateReadingReferences,
  rememberReadingLocation,
  type ReadingChange,
  type ReadingDocumentState,
  type ReadingPositionState,
  type ReadingState,
} from "./state";

/** 阅读现场由应用层持有，阅读器卸载只释放 DOM 和 PDF 渲染资源。 */
export function useReadingState() {
  const [state, setState] = useState<ReadingState>({
    positions: {},
    documents: {},
    references: {},
  });
  const updatePosition = useCallback(
    (key: string, change: ReadingChange<ReadingPositionState>) =>
      setState((previous) => updateReadingPosition(previous, key, change)),
    [],
  );
  const updateDocument = useCallback(
    (key: string, change: ReadingChange<ReadingDocumentState>) =>
      setState((previous) => updateReadingDocument(previous, key, change)),
    [],
  );
  const updateReferences = useCallback(
    (key: string, change: ReadingChange<DraftReference[]>) =>
      setState((previous) => updateReadingReferences(previous, key, change)),
    [],
  );
  const rememberLocation = useCallback(
    (location: ReadingSelection | MaterialLocation) =>
      setState((previous) => rememberReadingLocation(previous, location)),
    [],
  );
  return {
    state,
    updatePosition,
    updateDocument,
    updateReferences,
    rememberLocation,
  };
}
