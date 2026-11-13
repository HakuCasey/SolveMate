export type StudyBadgeSymbol =
  | "qi"
  | "foundation"
  | "elixir"
  | "spirit"
  | "divine"
  | "void"
  | "lotus"
  | "flame"
  | "furnace";
export interface StudyAchievement {
  id: string;
  name: string;
  kind: "total" | "streak";
  symbol: StudyBadgeSymbol;
  threshold: number;
}
/** 两个入口共用固定编号、排列顺序、条件和状态，不另存可独立修改的点亮标记。 */
export const studyAchievements: readonly StudyAchievement[] = [
  ...(
    [
      ["qi", "炼气", 1],
      ["foundation", "筑基", 8],
      ["elixir", "结丹", 16],
      ["spirit", "元婴", 32],
      ["divine", "化神", 64],
      ["void", "炼虚", 128],
      ["lotus", "大乘", 256],
    ] as const
  ).map(([symbol, name, threshold]) => ({
    id: `total-${symbol}`,
    name,
    kind: "total" as const,
    symbol,
    threshold,
  })),
  ...([1, 3, 7, 14, 30, 60, 100] as const).map((threshold) => ({
    id: `streak-${threshold}`,
    name: `连续 ${threshold} 天`,
    kind: "streak" as const,
    symbol: threshold <= 7 ? ("flame" as const) : ("furnace" as const),
    threshold,
  })),
];
export function achievementCondition(achievement: StudyAchievement) {
  return achievement.kind === "total"
    ? `累计学习满 ${achievement.threshold} 小时`
    : `连续学习满 ${achievement.threshold} 天`;
}
export function achievementStates(
  stats: { totalMs: number; longestStreak: number } | null,
) {
  return studyAchievements.map((achievement) => ({
    ...achievement,
    earned: stats
      ? achievement.kind === "total"
        ? stats.totalMs >= achievement.threshold * 3_600_000
        : stats.longestStreak >= achievement.threshold
      : false,
  }));
}
