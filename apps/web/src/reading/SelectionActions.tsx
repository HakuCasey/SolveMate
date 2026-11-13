import { createContext, useContext, type ReactNode } from "react";
import type { ReadingReference } from "@solvemate/contracts";

export type SelectionAction = "chat" | "note";
type Actions = {
  onChat: (reference: ReadingReference) => void;
  onNote: (reference: ReadingReference) => void;
};
const SelectionActionsContext = createContext<Actions | null>(null);

/** 两栏只负责提供选段，添加到对话或笔记的状态变更统一交给应用层。 */
export function SelectionActionsProvider({
  children,
  ...actions
}: Actions & { children: ReactNode }) {
  return (
    <SelectionActionsContext.Provider value={actions}>
      {children}
    </SelectionActionsContext.Provider>
  );
}
export function useSelectionActions() {
  const actions = useContext(SelectionActionsContext);
  if (!actions) throw new Error("SelectionActionsProvider is missing.");
  return actions;
}
