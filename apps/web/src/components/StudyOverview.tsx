import { Popover, Tooltip } from "radix-ui";
import { ChevronDown, Flame, Medal } from "lucide-react";
import styles from "./StudyOverview.module.css";

const lastCompletedDayIndex = 80;
const firstRecentDayIndex = 76;
const recentStudyMinutes = [25, 35, 50, 30, 42];
const earlierStudyMinutes = [15, 25, 40, 55, 30, 0, 20];

function getExampleMinutes(index: number): number | null {
  // 保留定稿中的示例时长，实际学习计时在后续功能中实现。
  if (index > lastCompletedDayIndex) return null;
  if (index >= firstRecentDayIndex)
    return recentStudyMinutes[index - firstRecentDayIndex];
  if (index === 75 || index % 7 === 6 || index % 9 === 2) return 0;
  return earlierStudyMinutes[
    (index * 3 + Math.floor(index / 7)) % earlierStudyMinutes.length
  ];
}

const studyDays = Array.from({ length: 12 * 7 }, (_, index) => {
  const minutes = getExampleMinutes(index);
  const level =
    minutes === null || minutes === 0
      ? 0
      : minutes <= 20
        ? 1
        : minutes <= 35
          ? 2
          : minutes <= 50
            ? 3
            : 4;
  const date = new Date(Date.UTC(2026, 7, 17 + index))
    .toISOString()
    .slice(0, 10);
  return { date, minutes, level };
});
const totalMinutes = studyDays.reduce(
  (total, day) => total + (day.minutes ?? 0),
  0,
);
const weekMinutes = studyDays
  .slice(77, lastCompletedDayIndex + 1)
  .reduce((total, day) => total + (day.minutes ?? 0), 0);
let consecutiveDays = 0;
for (
  let index = lastCompletedDayIndex;
  index >= 0 && (studyDays[index].minutes ?? 0) > 0;
  index--
)
  consecutiveDays++;

export function StudyTitle() {
  return (
    <Popover.Root>
      <Popover.Trigger className={styles.titleButton}>
        <span>求知新星</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.popover}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          aria-labelledby="study-duration-heading"
        >
          <h3 id="study-duration-heading">学习时长</h3>
          <div className={styles.metrics}>
            <div className={styles.stat}>
              <span className={styles.label}>今日学习</span>
              <span className={styles.value}>
                {studyDays[lastCompletedDayIndex].minutes}
                <small>分钟</small>
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.label}>本周学习</span>
              <span className={styles.value}>
                {Math.floor(weekMinutes / 60)}
                <small>时</small> {weekMinutes % 60}
                <small>分</small>
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.label}>连续学习</span>
              <span className={styles.value}>
                {consecutiveDays}
                <small>天</small>
              </span>
            </div>
          </div>
          <p className={styles.total}>
            累计学习 {Math.floor(totalMinutes / 60)} 小时 {totalMinutes % 60}{" "}
            分钟
          </p>
          <p className={styles.exampleNote}>
            以上为示例数据，尚未统计实际学习时长。
          </p>
          <Popover.Arrow className={styles.arrow} width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function StudyMedals() {
  return (
    <Tooltip.Provider delayDuration={250}>
      <div className={styles.medals}>
        <Tooltip.Root>
          <Tooltip.Trigger className={styles.medal} aria-label="专注十小时勋章">
            <Medal aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={styles.tooltip} sideOffset={8}>
              专注十小时：累计学习满 10 小时（示例）
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger
            className={styles.medal}
            aria-label="连续学习五天勋章"
          >
            <Flame aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={styles.tooltip} sideOffset={8}>
              稳步前行：连续学习 5 天（示例）
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}

export function StudyFootprint() {
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
          aria-label={`近十二周每日学习时长示例，累计 ${totalMinutes} 分钟。颜色越深表示时长越长。`}
        >
          {studyDays.map((day) => (
            <Tooltip.Root key={day.date}>
              <Tooltip.Trigger asChild>
                <span
                  className={styles.day}
                  data-level={day.level}
                  data-future={day.minutes === null}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className={styles.tooltip} sideOffset={8}>
                  {day.date} ·{" "}
                  {day.minutes === null
                    ? "尚未开始"
                    : `学习 ${day.minutes} 分钟`}
                  （示例）
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
      </section>
    </Tooltip.Provider>
  );
}
