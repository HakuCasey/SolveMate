/** 在文件进入上传步骤前检查格式和大小，实际内容仍由本机服务校验。 */
export function uploadFileError(file: Pick<File, "name" | "size">): string {
  if (!/\.(pdf|pptx)$/i.test(file.name)) return "仅支持 PDF 和 PPTX 文件。";
  if (file.size === 0) return "文件为空，请重新选择。";
  if (file.size > 100 * 1024 * 1024)
    return "文件超过 100 MiB，请拆分或压缩后上传。";
  return "";
}
