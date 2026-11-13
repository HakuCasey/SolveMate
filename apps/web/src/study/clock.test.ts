import { describe, expect, it } from "vitest";
import { StudyClock, idleLimitMs } from "./clock";
const sample = (milliseconds: number) => ({
  wall: 1_700_000_000_000 + milliseconds,
  monotonic: milliseconds,
});
function setup(allowed = true) {
  const clock = new StudyClock(sample(0));
  clock.configure(allowed, "reading", "", sample(0));
  clock.visibility(true, sample(0));
  return clock;
}
function total(clock: StudyClock, ms: number) {
  return clock
    .drain(sample(ms))
    .reduce((sum, span) => sum + span.endMs - span.startMs, 0);
}
describe("event-based study time", () => {
  it("counts the intervals between events and stops at five minutes after the last event", () => {
    const clock = setup();
    let duration = total(clock, 60_000);
    clock.activity(sample(120_000));
    for (let i = 2; i <= 8; i++) duration += total(clock, i * 60_000);
    expect(duration).toBe(7 * 60_000);
    clock.activity(sample(20 * 60_000));
    expect(total(clock, 21 * 60_000)).toBe(60_000);
  });
  it("counts AI updates as events but does not renew time for repeated snapshots", () => {
    const clock = setup(false);
    clock.configure(true, "ai", "start", sample(0));
    let duration = 0;
    for (let i = 1; i <= 8; i++) {
      clock.configure(
        true,
        "ai",
        i >= 3 ? "content-1" : "start",
        sample(i * 60_000),
      );
      duration += total(clock, i * 60_000);
    }
    expect(duration).toBe(8 * 60_000);
    expect(total(clock, 9 * 60_000)).toBe(0);
    clock.configure(true, "ai", "finished", sample(9 * 60_000));
    expect(total(clock, 10 * 60_000)).toBe(60_000);
  });
  it("pauses on hidden or non-study pages and excludes the entire hidden gap", () => {
    const clock = setup(false);
    clock.activity(sample(30_000));
    expect(total(clock, 60_000)).toBe(0);
    clock.configure(true, "reading", "", sample(60_000));
    clock.visibility(false, sample(90_000));
    clock.visibility(true, sample(150_000));
    expect(total(clock, 180_000)).toBe(60_000);
    clock.configure(false, "settings", "", sample(180_000));
    expect(total(clock, 240_000)).toBe(0);
  });
  it("discards sleep and clock jumps rather than filling the elapsed gap", () => {
    const clock = setup();
    expect(total(clock, 60_000)).toBe(60_000);
    expect(total(clock, 600_000)).toBe(0);
    clock.activity(sample(600_000));
    clock.advance({ wall: sample(700_000).wall, monotonic: 610_000 });
    expect(total(clock, 700_000)).toBe(0);
  });
  it("does not double-count simultaneous activities or repeated checkpoints", () => {
    const clock = setup();
    clock.configure(true, "reading-and-chat", "start", sample(0));
    for (let i = 0; i < 500; i++) clock.activity(sample(i * 100));
    expect(clock.drain(sample(50_000))).toEqual([
      { startMs: sample(0).wall, endMs: sample(50_000).wall },
    ]);
    expect(clock.drain(sample(50_000))).toEqual([]);
  });
  it("keeps only one bounded checkpoint schedule and reaches the precise idle deadline", () => {
    const clock = setup();
    clock.activity(sample(30_000));
    expect(clock.nextWakeMs(sample(300_000))).toBe(30_000);
    clock.drain(sample(300_000));
    clock.drain(sample(330_000));
    expect(clock.active(sample(330_000))).toBe(false);
    expect(clock.hasPending()).toBe(false);
    expect(idleLimitMs).toBe(300_000);
  });
});
