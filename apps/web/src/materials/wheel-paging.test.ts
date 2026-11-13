import { describe, expect, it } from "vitest";
import { WheelPaging } from "./wheel-paging";

const event = (deltaY: number) => ({
  deltaY,
  deltaX: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
});
const middle = { scrollTop: 100, scrollHeight: 1500, clientHeight: 500 };
const bottom = { ...middle, scrollTop: 1000 };

describe("single-page wheel navigation", () => {
  it("scrolls within the page and turns only at its boundary", () => {
    const wheel = new WheelPaging();
    expect(wheel.handle(event(100), middle, 2, 5, 0)).toEqual({
      consume: false,
      page: 2,
    });
    expect(wheel.handle(event(100), bottom, 2, 5, 30)).toEqual({
      consume: true,
      page: 3,
    });
  });
  it("consumes inertial events after a turn and permits the next gesture", () => {
    const wheel = new WheelPaging();
    expect(wheel.handle(event(100), bottom, 2, 5, 0).page).toBe(3);
    expect(wheel.handle(event(80), bottom, 3, 5, 30)).toEqual({
      consume: true,
      page: 3,
    });
    expect(wheel.handle(event(60), bottom, 3, 5, 60).page).toBe(3);
    expect(wheel.handle(event(100), bottom, 3, 5, 300).page).toBe(4);
  });
  it("accumulates small trackpad movements and never goes beyond document bounds", () => {
    const wheel = new WheelPaging();
    expect(wheel.handle(event(20), bottom, 1, 5, 0).page).toBe(1);
    expect(wheel.handle(event(30), bottom, 1, 5, 20).page).toBe(2);
    expect(wheel.handle(event(100), bottom, 5, 5, 400)).toEqual({
      consume: false,
      page: 5,
    });
    expect(
      wheel.handle(event(-100), { ...middle, scrollTop: 0 }, 1, 5, 700),
    ).toEqual({ consume: false, page: 1 });
  });
  it("preserves horizontal pan and pinch or modifier-wheel gestures", () => {
    const wheel = new WheelPaging();
    expect(
      wheel.handle({ ...event(20), deltaX: 100 }, bottom, 2, 5, 0).consume,
    ).toBe(false);
    expect(
      wheel.handle({ ...event(100), ctrlKey: true }, bottom, 2, 5, 30).consume,
    ).toBe(false);
  });
});
