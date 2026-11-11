import { localAi, LocalAiError, type Detection } from "./local-api";

/** 仅在命令缺失且用户未填写路径时，尝试一次本机服务提供的默认安装位置。 */
export async function detectConnection(
  executablePath: string,
  model: string,
  defaultPath: string,
  onDefaultPath: (path: string) => void,
  probe: typeof localAi.detect = localAi.detect,
): Promise<Detection> {
  try {
    return await probe(executablePath, model);
  } catch (error) {
    if (
      executablePath.trim() ||
      !(error instanceof LocalAiError) ||
      error.code !== "program_missing" ||
      !defaultPath
    )
      throw error;
  }
  // 先显示候选路径，再连接；失败时保留路径，供用户更正。
  onDefaultPath(defaultPath);
  try {
    return await probe(defaultPath, model);
  } catch (error) {
    if (error instanceof LocalAiError && error.code === "program_missing")
      throw new LocalAiError(
        "默认位置未找到所选服务，请填写实际安装路径，然后点击“检测连接”。",
        "program_missing",
      );
    throw error;
  }
}
