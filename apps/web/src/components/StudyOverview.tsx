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
  const collection = (compact: boolean) => (
    <div
      className={compact ? styles.badges : styles.collection}
      data-study-achievement-entry={compact ? panelId : undefined}
    >
      {(["total", "streak"] as const).map((kind) => (
        <div
          className={styles.achievementGroup}
          key={kind}
          role="group"
          aria-label={kind === "total" ? "累计学习勋章" : "连续学习勋章"}
        >
          {!compact && (
            <span className={styles.groupLabel}>
              {kind === "total" ? "累计学习" : "连续学习"}
            </span>
          )}
          <div className={styles.badgeRow}>
            {badges
              .filter((badge) => badge.kind === kind)
              .map((badge) => {
                const state = !summary
                  ? "统计尚未读取"
                  : badge.earned
                    ? "已点亮"
                    : "未点亮";
                const label = `${badge.name} · ${state}`;
                const icon = (
                  <StudyBadgeIcon
                    symbol={badge.symbol}
                    days={badge.kind === "streak" ? badge.threshold : undefined}
                    earned={badge.earned}
                    className={styles.badgeIcon}
                  />
                );
                const button = (
                  <button
                    key={badge.id}
                    type="button"
                    className={styles.badge}
                    data-earned={badge.earned}
                    data-selected={
                      (!compact && selectedId === badge.id) || undefined
                    }
                    aria-label={label}
                    aria-pressed={
                      !compact ? selectedId === badge.id : undefined
                    }
                    aria-haspopup={compact ? "dialog" : undefined}
                    aria-expanded={
                      compact ? open && selectedId === badge.id : undefined
                    }
                    aria-controls={compact && open ? panelId : undefined}
                    onClick={(event) => {
                      setSelectedId(badge.id);
                      if (compact) {
                        trigger.current = event.currentTarget;
                        setOpen(true);
                      }
                    }}
                  >
                    {icon}
                  </button>
                );
                return button;
              })}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>{collection(true)}</Popover.Anchor>
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
          {collection(false)}
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
