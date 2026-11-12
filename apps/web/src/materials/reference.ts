import type {
  Material,
  MaterialLocation,
  ReadingReference,
} from "@solvemate/contracts";
export function makeMaterialReference(
  material: Pick<Material, "id" | "title" | "currentVersion">,
  location: MaterialLocation,
  text: string,
  quoteKind: "page" | "selection",
): ReadingReference {
  if (
    material.id !== location.materialId ||
    material.currentVersion !== location.contentVersion
  )
    throw new Error("引用的资料版本不一致，请重新选择。");
  if (!text.trim())
    throw new Error(
      "本页没有可提取的文字。当前暂不支持图片内容提问，可以取消引用后讨论。",
    );
  if (text.length > 100000)
    throw new Error("引用内容过长，请选择较短的段落后提问。");
  return {
    title: `${material.title} · 第 ${location.pageNumber} 页`,
    selection: null,
    material: { ...location },
    quoteKind,
    content: text,
  };
}
