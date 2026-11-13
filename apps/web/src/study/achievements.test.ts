import { describe, expect, it } from "vitest";
import type { StudySummary } from "@solvemate/contracts";
import {
  achievementCondition,
  achievementStates,
  studyAchievements,
} from "./achievements";
import { dateOffset, studyOverview } from "./summary";
const empty: StudySummary = { storeId: "test", today: "2026-11-13", days: [] };
describe("study achievement metadata", () => {
  it("uses the confirmed thresholds and unique stable identifiers for both rows", () => {
    expect(
      studyAchievements
        .filter((item) => item.kind === "total")
        .map((item) => [item.name, item.threshold]),
    ).toEqual([
      ["炼气", 1],
      ["筑基", 8],
      ["结丹", 16],
      ["元婴", 32],
      ["化神", 64],
      ["炼虚", 128],
      ["大乘", 256],
    ]);
    expect(
      studyAchievements
        .filter((item) => item.kind === "streak")
        .map((item) => item.threshold),
    ).toEqual([1, 3, 7, 14, 30, 60, 100]);
    expect(new Set(studyAchievements.map((item) => item.id)).size).toBe(14);
    expect(achievementCondition(studyAchievements[1])).toBe(
      "累计学习满 8 小时",
    );
  });
  it("does not invent unlocked achievements before statistics load or before learning", () => {
    expect(achievementStates(null).some((item) => item.earned)).toBe(false);
    expect(
      achievementStates(studyOverview(empty)).some((item) => item.earned),
    ).toBe(false);
  });
  it.each([1, 8, 16, 32, 64, 128, 256])(
    "unlocks a total-time tier exactly at %s hours",
    (hours) => {
      const values = (milliseconds: number) =>
        achievementStates({ totalMs: milliseconds, longestStreak: 0 }).filter(
          (item) => item.kind === "total",
        );
      const before = values(hours * 3_600_000 - 1),
        after = values(hours * 3_600_000);
      expect(before.find((item) => item.threshold === hours)?.earned).toBe(
        false,
      );
      expect(after.find((item) => item.threshold === hours)?.earned).toBe(true);
    },
  );
  it("keeps earned streaks after a break without changing the currently displayed streak", () => {
    const days = Array.from({ length: 16 }, (_, index) => ({
      date: dateOffset("2026-10-01", index),
      milliseconds: 2 * 3_600_000,
    }));
    const summary = {
      ...empty,
      days: [...days, { date: empty.today, milliseconds: 60_000 }],
    };
    expect(studyOverview(summary)).toMatchObject({
      consecutiveDays: 1,
      longestStreak: 16,
    });
    const state = achievementStates(studyOverview(summary));
    expect(state.find((item) => item.id === "streak-14")?.earned).toBe(true);
    expect(state.find((item) => item.id === "streak-30")?.earned).toBe(false);
    expect(state.find((item) => item.id === "total-spirit")?.earned).toBe(true);
    expect(state.find((item) => item.id === "total-divine")?.earned).toBe(
      false,
    );
  });
});
