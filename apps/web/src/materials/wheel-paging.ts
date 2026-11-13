/** 单页模式仅在页边界翻页，同一次触控板惯性滚动不会连续跳过多页。 */
export class WheelPaging {
  private lastAt = -Infinity;
  private locked = false;
  private distance = 0;
  handle(
    event: Pick<
      WheelEvent,
      "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey"
    >,
    viewport: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
    page: number,
    count: number,
    at = performance.now(),
  ) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return { consume: false, page };
    if (at - this.lastAt > 180) {
      this.locked = false;
      this.distance = 0;
    }
    this.lastAt = at;
    if (this.locked) return { consume: true, page };
    const delta =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? viewport.clientHeight
          : 1);
    const next = delta > 0 ? page + 1 : page - 1;
    const edge =
      delta > 0
        ? viewport.scrollTop + viewport.clientHeight >=
          viewport.scrollHeight - 2
        : viewport.scrollTop <= 2;
    if (!delta || !edge || next < 1 || next > count) {
      this.distance = 0;
      return { consume: false, page };
    }
    if (Math.sign(this.distance) !== Math.sign(delta)) this.distance = 0;
    this.distance += delta;
    if (Math.abs(this.distance) < 45) return { consume: true, page };
    this.locked = true;
    return { consume: true, page: next };
  }
}
