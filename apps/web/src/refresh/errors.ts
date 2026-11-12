/** 数据已变化与连接故障分别处理；刷新不重做原来的写入操作。 */
export class DataRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
export function isStaleData(error: unknown): boolean {
  return (
    error instanceof DataRequestError &&
    (error.status === 404 || error.status === 409)
  );
}
export function requireCurrentRecord<T extends { revision: number }>(
  record: T | undefined,
  expected: number | undefined,
  label = "记录",
): asserts record is T {
  if (!record)
    throw new DataRequestError(
      `${label}已删除，输入内容仍保留，请刷新后重新选择。`,
      "record_missing",
      404,
    );
  if (expected !== undefined && record.revision !== expected)
    throw new DataRequestError(
      `${label}已更新，输入内容仍保留，请核对最新内容后再次保存。`,
      "revision_conflict",
      409,
    );
}
