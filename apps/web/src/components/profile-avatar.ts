/** 头像只保存显示所需的方形缩略图，备份和恢复沿用现有的用户设置。 */
export async function readProfileAvatar(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 PNG、JPG 或 WebP 图片。");
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error();
    context.drawImage(
      image,
      (image.naturalWidth - crop) / 2,
      (image.naturalHeight - crop) / 2,
      crop,
      crop,
      0,
      0,
      160,
      160,
    );
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("无法读取这张图片，请重新选择。");
  } finally {
    URL.revokeObjectURL(src);
  }
}
