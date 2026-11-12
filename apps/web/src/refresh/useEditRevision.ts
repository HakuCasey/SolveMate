import { useRef } from "react";
import { DataRequestError } from "./errors";
import { dataEqual } from "./merge";

/** 编辑基线只在明确提示后推进；下一次保存代表用户重新确认，不自动重放操作。 */
export class EditGuard {
  constructor(
    private expected: unknown,
    private readonly allowCreate = false,
  ) {}
  check(current: unknown) {
    if (current === undefined) {
      if (this.allowCreate && this.expected === undefined) return;
      throw new DataRequestError(
        "记录已删除，输入内容仍保留，请重新选择或复制草稿。",
        "record_missing",
        404,
      );
    }
    if (!dataEqual(this.expected, current)) {
      this.expected = structuredClone(current);
      throw new DataRequestError(
        "记录已更新，输入内容仍保留，请核对最新内容后再次保存。",
        "revision_conflict",
        409,
      );
    }
  }
}
export function useEditValue(
  initial: unknown,
  current: unknown,
  identity = "record",
  allowCreate = false,
) {
  const guard = useRef({
    identity,
    value: new EditGuard(initial, allowCreate),
  });
  const check = () => {
    if (guard.current.identity !== identity)
      guard.current = { identity, value: new EditGuard(initial, allowCreate) };
    guard.current.value.check(current);
  };
  check.accept = (value: unknown) => {
    guard.current = { identity, value: new EditGuard(value, allowCreate) };
  };
  return check;
}
export function useEditRevision(
  initial: { revision: number },
  current: { revision: number } | undefined,
  identity = "record",
  allowCreate = false,
) {
  const check = useEditValue(
    allowCreate && initial.revision === 0 ? undefined : initial.revision,
    current?.revision,
    identity,
    allowCreate,
  );
  return () => {
    check();
    return current?.revision ?? 0;
  };
}
