export type ReloadLoadState = "loading" | "ready" | "error";

/** 应用更新后的页面只自动补读一次；仍失败时交给现有的手动重新读取入口。 */
export async function refreshAfterApplicationUpdate({
  loadState,
  retryRead,
  refresh,
}: {
  loadState: ReloadLoadState;
  retryRead: () => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  if (loadState === "loading") return false;
  if (loadState === "error") await retryRead();
  await refresh();
  return true;
}
