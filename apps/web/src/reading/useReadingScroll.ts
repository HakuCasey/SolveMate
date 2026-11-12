import { useLayoutEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  readingScrollFromElement,
  readingScrollToElement,
  type ReadingPositionState,
  type ReadingScroll,
} from "./state";

/** 两类阅读器共用恢复时序，加载中的临时高度不能覆盖已保存的位置。 */
export function useReadingScroll(
  root: RefObject<HTMLElement | null>,
  key: string,
  scroll: ReadingScroll,
  onChange: Dispatch<SetStateAction<ReadingPositionState>>,
  ready = true,
  scale = 1,
) {
  const saved = useRef(scroll);
  useLayoutEffect(() => {
    saved.current = scroll;
  }, [scroll]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !ready) return;
    const target = readingScrollToElement(saved.current, scale, node);
    node.scrollTo({ ...target, behavior: "instant" });
    function capture() {
      const next = readingScrollFromElement(node!, scale);
      onChange((previous) =>
        previous.scroll.top === next.top && previous.scroll.left === next.left
          ? previous
          : { ...previous, scroll: next },
      );
    }
    node.addEventListener("scroll", capture, { passive: true });
    return () => {
      // 页面切换可以早于 scroll 事件派发，卸载前补记最后一次实际位置。
      capture();
      node.removeEventListener("scroll", capture);
    };
  }, [root, key, ready, scale, onChange]);
}
