import { PopoverPanel } from "./PopoverPanel";
import { Popover, Tooltip } from "radix-ui";
import { Clock3 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { achievementCondition, achievementStates } from "../study/achievements";
import { StudyBadgeIcon } from "./StudyBadgeIcon";
import { useStudyTime } from "../study/StudyProvider";
import { durationMinutes, studyOverview } from "../study/summary";
import styles from "./StudyOverview.module.css";

export function StudyAchievements() {
  const { summary, error, retry } = useStudyTime();
  const stats = summary ? studyOverview(summary) : null;
  const badges = achievementStates(stats);
  const [selectedId, setSelectedId] = useState(badges[0].id);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = badges.find((badge) => badge.id === selectedId)!;
  const kinds = ["total", "streak"] as const;
  const highest = kinds.map((kind) => {
    const family = badges.filter((badge) => badge.kind === kind);
    return family.filter((badge) => badge.earned).at(-1) ?? family[0];
  });
  const icon = (badge: (typeof badges)[number]) => (
    <StudyBadgeIcon
      symbol={badge.symbol}
      days={badge.kind === "streak" ? badge.threshold : undefined}
      earned={badge.earned}
      className={styles.badgeIcon}
    />
  );
  function entry(badge: (typeof badges)[number]) {
    return (
      <button
        key={badge.kind}
        type="button"
        className={`${styles.badge} ${styles.entry}`}
        data-earned={badge.earned}
        aria-label={`${badge.name} · ${!summary ? "统计尚未读取" : badge.earned ? "已点亮" : "未点亮"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setSelectedId(badge.id);
          setOpen(true);
        }}
      >
        {icon(badge)}
      </button>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={styles.badges} data-study-achievement-entry={panelId}>
          {highest.map(entry)}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <PopoverPanel
          id={panelId}
          onInteractOutside={(event) => {
            const target = event.target;
            if (
              target instanceof Element &&
              target
                .closest("[data-study-achievement-entry]")
                ?.getAttribute("data-study-achievement-entry") === panelId
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          title="学习时长"
          icon={Clock3}
          titleId="study-duration-heading"
          width={300}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          aria-labelledby="study-duration-heading"
        >
          <div className={styles.metrics}>
            <div className={styles.stat}>
              <span className={styles.label}>今日学习</span>
              <span className={styles.value}>
                {stats ? durationMinutes(stats.todayMs) : "—"}
                <small>分钟</small>
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.label}>本周学习</span>
              <span className={styles.value}>
                {stats ? Math.floor(stats.weekMs / 3_600_000) : "—"}
                <small>时</small>{" "}
                {stats ? Math.floor(stats.weekMs / 60_000) % 60 : "—"}
                <small>分</small>
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.label}>连续学习</span>
              <span className={styles.value}>
                {stats?.consecutiveDays ?? "—"}
                <small>天</small>
              </span>
            </div>
          </div>
          <p className={styles.total}>
            累计学习 {stats ? Math.floor(stats.totalMs / 3_600_000) : "—"} 小时{" "}
            {stats ? Math.floor(stats.totalMs / 60_000) % 60 : "—"} 分钟
          </p>
          <div className={styles.collection}>
            {kinds.map((kind) => {
              const label = kind === "total" ? "累计学习" : "连续学习";
              return (
                <div key={kind} role="group" aria-label={label + "勋章"}>
                  <span className={styles.groupLabel}>{label}</span>
                  <div className={styles.badgeRow}>
                    {badges
                      .filter((badge) => badge.kind === kind)
                      .map((badge) => (
                        <button
                          key={badge.id}
                          type="button"
                          className={styles.badge}
                          data-earned={badge.earned}
                          data-selected={selectedId === badge.id || undefined}
                          aria-pressed={selectedId === badge.id}
                          aria-label={`${badge.name} · ${!summary ? "统计尚未读取" : badge.earned ? "已点亮" : "未点亮"}`}
                          onClick={() => setSelectedId(badge.id)}
                        >
                          {icon(badge)}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.achievementDetail} aria-live="polite">
            <div className={styles.detailHeading}>
              <strong>{selected.name}</strong>
              <span data-earned={selected.earned}>
                {!summary
                  ? "统计尚未读取"
                  : selected.earned
                    ? "已点亮"
                    : "未点亮"}
              </span>
            </div>
            <p>{achievementCondition(selected)}</p>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}{" "}
              <button
                type="button"
                onClick={() => void retry?.().catch(() => undefined)}
              >
                重试
              </button>
            </p>
          )}
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function StudyFootprint() {
  const { summary } = useStudyTime();
  const days = summary ? studyOverview(summary).days : [];
  return (
    <Tooltip.Provider delayDuration={250}>
      <section className={styles.footprint} aria-label="学习足迹">
        <div className={styles.mapLabel}>
          <span>学习足迹</span>
          <span>近 12 周</span>
        </div>
        <div
          className={styles.map}
          role="img"
          aria-label={
            summary
              ? "近十二周每日学习时长。颜色越深表示时长越长。"
              : "正在读取学习时长"
          }
        >
          {days.map((day) => (
            <Tooltip.Root key={day.date}>
              <Tooltip.Trigger asChild>
                <span
                  className={styles.day}
                  data-level={day.level}
                  data-future={day.future}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} sideOffset={8}>
                  {day.date} ·{" "}
                  {day.future
                    ? "尚未开始"
                    : `学习 ${durationMinutes(day.milliseconds)} 分钟`}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
      </section>
    </Tooltip.Provider>
  );
}
