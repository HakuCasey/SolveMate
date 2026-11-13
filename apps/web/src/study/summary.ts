import type { StudySummary } from "@solvemate/contracts";
export function dateOffset(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day + days, 12);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function studyOverview(summary: StudySummary) {
  const minutes = new Map(
    summary.days.map((day) => [day.date, day.milliseconds]),
  );
  const [y, m, d] = summary.today.split("-").map(Number);
  const monday = dateOffset(
    summary.today,
    -((new Date(y, m - 1, d, 12).getDay() + 6) % 7),
  );
  const start = dateOffset(monday, -77);
  const days = Array.from({ length: 84 }, (_, index) => {
    const date = dateOffset(start, index),
      milliseconds = minutes.get(date) ?? 0;
    return {
      date,
      milliseconds,
      future: date > summary.today,
      level:
        milliseconds <= 0
          ? 0
          : milliseconds <= 20 * 60_000
            ? 1
            : milliseconds <= 35 * 60_000
              ? 2
              : milliseconds <= 50 * 60_000
                ? 3
                : 4,
    };
  });
  let consecutiveDays = 0;
  let date =
    (minutes.get(summary.today) ?? 0) > 0
      ? summary.today
      : dateOffset(summary.today, -1);
  while ((minutes.get(date) ?? 0) > 0) {
    consecutiveDays++;
    date = dateOffset(date, -1);
  }
  let longestStreak = 0,
    streak = 0,
    previousDate = "";
  for (const date of [...minutes.keys()]
    .filter((date) => date <= summary.today && minutes.get(date)! > 0)
    .sort()) {
    streak =
      previousDate && dateOffset(previousDate, 1) === date ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previousDate = date;
  }
  return {
    days,
    consecutiveDays,
    longestStreak,
    todayMs: minutes.get(summary.today) ?? 0,
    weekMs: summary.days
      .filter((day) => day.date >= monday && day.date <= summary.today)
      .reduce((sum, day) => sum + day.milliseconds, 0),
    totalMs: summary.days.reduce((sum, day) => sum + day.milliseconds, 0),
  };
}
export function durationMinutes(milliseconds: number) {
  return milliseconds > 0 && milliseconds < 60_000
    ? "不足 1"
    : String(Math.floor(milliseconds / 60_000));
}
