import { expect, it } from "vitest";
import { dateOffset, studyOverview } from "./summary";
it("summarizes actual days, keeps yesterday's streak and builds twelve calendar weeks", () => {
  const stats = studyOverview({
    storeId: "local",
    today: "2026-11-13",
    days: [
      { date: "2026-11-10", milliseconds: 60_000 },
      { date: "2026-11-11", milliseconds: 120_000 },
      { date: "2026-11-12", milliseconds: 180_000 },
      { date: "2026-10-01", milliseconds: 60_000 },
    ],
  });
  expect(stats).toMatchObject({
    todayMs: 0,
    weekMs: 360_000,
    totalMs: 420_000,
    consecutiveDays: 3,
  });
  expect(stats.days).toHaveLength(84);
  expect(stats.days.at(-1)).toMatchObject({ date: "2026-11-15", future: true });
  expect(dateOffset("2026-03-01", -1)).toBe("2026-02-28");
});
