import type { StudyInterval } from "@solvemate/contracts";
export const idleLimitMs = 5 * 60_000;
export const checkpointMs = 60_000;
const maxGapMs = 90_000;
export interface ClockSample {
  wall: number;
  monotonic: number;
}
export const clockSample = (): ClockSample => ({
  wall: Date.now(),
  monotonic: performance.now(),
});

/** 只收集有效的时间段；事件不触发界面刷新、网络请求或数据库写入。 */
export class StudyClock {
  private previous: ClockSample;
  private lastActivity: number;
  private allowed = false;
  private sceneKey = "";
  private aiEvent = "";
  private visible = false;
  private pending: StudyInterval[] = [];
  constructor(sample: ClockSample) {
    this.previous = sample;
    this.lastActivity = sample.wall;
  }
  advance(sample: ClockSample) {
    const start = this.previous.wall;
    const elapsed = sample.wall - start;
    const monotonic = sample.monotonic - this.previous.monotonic;
    if (
      this.visible &&
      this.allowed &&
      elapsed > 0 &&
      elapsed <= maxGapMs &&
      monotonic >= 0 &&
      Math.abs(elapsed - monotonic) < 5000
    ) {
      const end = Math.min(sample.wall, this.lastActivity + idleLimitMs);
      if (end > start) {
        const last = this.pending.at(-1);
        if (last?.endMs === start) last.endMs = end;
        else this.pending.push({ startMs: start, endMs: end });
      }
    }
    this.previous = sample;
  }
  configure(
    allowed: boolean,
    sceneKey: string,
    aiEvent: string,
    sample: ClockSample,
  ) {
    this.advance(sample);
    if (
      (allowed && (!this.allowed || sceneKey !== this.sceneKey)) ||
      (aiEvent && aiEvent !== this.aiEvent)
    )
      this.lastActivity = sample.wall;
    this.allowed = allowed;
    this.sceneKey = sceneKey;
    if (aiEvent) this.aiEvent = aiEvent;
  }
  visibility(visible: boolean, sample: ClockSample) {
    this.advance(sample);
    if (visible && !this.visible) this.lastActivity = sample.wall;
    this.visible = visible;
  }
  activity(sample: ClockSample) {
    this.advance(sample);
    this.lastActivity = sample.wall;
  }
  active(sample: ClockSample) {
    return (
      this.visible &&
      this.allowed &&
      sample.wall < this.lastActivity + idleLimitMs
    );
  }
  nextWakeMs(sample: ClockSample) {
    return Math.max(
      0,
      Math.min(checkpointMs, this.lastActivity + idleLimitMs - sample.wall),
    );
  }
  hasPending() {
    return this.pending.length > 0;
  }
  drain(sample: ClockSample) {
    this.advance(sample);
    const result = this.pending;
    this.pending = [];
    return result;
  }
}
