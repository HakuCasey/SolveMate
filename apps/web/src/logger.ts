export function logError(message: string, error: unknown): void {
  // 日志仅记录错误类别，避免输出用户问题、笔记或连接凭据。
  console.error(`[SolveMate] ${message}`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}
