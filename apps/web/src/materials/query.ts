import type { Material } from "@solvemate/contracts";

interface MaterialList {
  items: Material[];
  warning: string;
}

/** 只发布最新查询的结果；写入开始或完成后，先前请求的结果和错误均失效。 */
export function createMaterialQuery(
  read: () => Promise<MaterialList>,
  publish: (value: MaterialList) => void,
  fail: (message: string) => void,
) {
  let generation = 0;
  return {
    invalidate() {
      generation++;
    },
    async restoreCached(readCached: () => Promise<Material[]>) {
      const request = generation;
      try {
        const items = await readCached();
        if (request === generation) publish({ items, warning: "" });
      } catch {
        /* 浏览器缓存不可用时，继续从本机服务读取。 */
      }
    },
    async refresh() {
      const request = ++generation;
      try {
        const next = await read();
        if (request === generation) publish(next);
        return next;
      } catch (failure) {
        if (request === generation)
          fail(failure instanceof Error ? failure.message : "读取资料失败。");
        return null;
      }
    },
  };
}
