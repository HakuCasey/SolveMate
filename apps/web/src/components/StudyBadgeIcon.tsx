import type { StudyBadgeSymbol } from "../study/achievements";

/** 前三阶仅用火焰，主体宽高逐级递增；四阶炼丹炉通过结构区分。 */
const flameShapes: Record<number, string> = {
  1: "M9.024 16C5.394 12.727 12.654 11.091 11.746 7C16.284 10.273 17.191 13.545 14.469 16",
  3: "M7.99 16C4.474 11.385 11.507 10.615 10.803 6C13.616 7.538 14.32 9.846 13.616 12.154C15.023 11.385 15.726 9.846 15.726 9.846C17.836 12.923 17.133 14.462 15.023 16",
  7: "M7.134 16C4.483 12.857 7.134 10.5 8.46 8.929C8.46 11.286 9.786 12.071 10.448 12.071C9.786 8.929 13.762 7.357 13.099 5C16.413 7.357 16.413 10.5 15.088 12.857C16.413 12.071 17.076 10.5 17.076 10.5C18.402 12.857 18.402 14.429 16.413 16",
};

/** 借鉴虚天鼎的直颈、鼓腹与三足，双耳沿鼎身向上延伸；不叠画被遮挡的线。 */
const furnaceShapes: Record<number, { body: string; details: string }> = {
  14: {
    body: "M8 5v3c-2.5 4 .5 5.5 4 5.5s6.5-1.5 4-5.5V5",
    details:
      "M8 5a4 1.2 0 1 0 8 0 4 1.2 0 1 0-8 0M8.5 13l-1 3M12 13.5V16M15.5 13l1 3",
  },
  30: {
    body: "M7.5 5v3c-3 4.2 .5 5.5 4.5 5.5s7.5-1.3 4.5-5.5V5",
    details:
      "M7.5 5a4.5 1.2 0 1 0 9 0 4.5 1.2 0 1 0-9 0M7.5 7H5V4.5h1M16.5 7H19V4.5h-1M8 13l-1 3M12 13.5V16M16 13l1 3",
  },
  60: {
    body: "M7 5v3c-3.5 4.2 .5 5.5 5 5.5s8.5-1.3 5-5.5V5",
    details:
      "M7 5a5 1.2 0 1 0 10 0 5 1.2 0 1 0-10 0M7 7H4V3.5h1.5M17 7h3V3.5h-1.5M7 7.5h10M12 9l1.5 1.5-1.5 1.5-1.5-1.5ZM8 13l-1 3M12 13.5V16M16 13l1 3",
  },
  100: {
    body: "M6.5 5v3c-4 4.2 .5 5.5 5.5 5.5s9.5-1.3 5.5-5.5V5",
    details:
      "M6.5 5a5.5 1.2 0 1 0 11 0 5.5 1.2 0 1 0-11 0M6.5 7H3.5V3h2M17.5 7h3V3h-2M6.5 7.5h11M10.5 9h3v3h-3ZM8 13l-1 3H5.5M12 13.5V16h1M16 13l1 3h1.5",
  },
};
/** 24px 图形与侧栏图标共用 currentColor；点亮主体加色块，未点亮仅显示轮廓。 */
export function StudyBadgeIcon({
  symbol,
  days,
  earned,
  className,
}: {
  symbol: StudyBadgeSymbol;
  days?: number;
  earned: boolean;
  className?: string;
}) {
  const core = earned ? "currentColor" : "none";
  const flame = flameShapes[days ?? 1] ?? flameShapes[1];
  const furnace = furnaceShapes[days ?? 14] ?? furnaceShapes[14];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={earned ? 1.9 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-earned={earned}
    >
      {symbol === "qi" && (
        // 等距螺旋的内端留白与圈间留白相近，光学居中后保留开放收尾。
        <path d="M2.5 13.25C2.71 10.4 4.04 7.85 6.09 6.1C8.13 4.36 10.72 3.56 13.24 3.77C15.75 3.98 17.99 5.18 19.5 6.99C21.01 8.8 21.67 11.07 21.46 13.25C21.25 15.43 20.18 17.35 18.61 18.62C17.03 19.9 15.08 20.43 13.24 20.22C11.39 20.01 9.79 19.07 8.75 17.73C7.71 16.39 7.31 14.77 7.52 13.25C7.73 11.73 8.53 10.46 9.64 9.65C10.74 8.85 12.05 8.58 13.24 8.79C14.42 9 15.38 9.67 15.95 10.54C16.51 11.41 16.65 12.4 16.44 13.25C16.23 14.1 15.69 14.74 15.06 15.07" />
      )}
      {symbol === "foundation" && (
        <>
          <path d="M8 5h8v4H8zM5 9h14v5H5z" fill={core} fillOpacity=".18" />
          <path d="M2.5 14h19v5h-19z" fill={core} fillOpacity=".5" />
        </>
      )}
      {symbol === "elixir" && (
        <>
          <circle cx="12" cy="12" r="6.5" fill={core} fillOpacity=".55" />
          {/* 后半圈只保留丹体外的两段，前半圈从丹体前方经过。 */}
          <g transform="rotate(-28 12 12)">
            <path d="M1 12a11 3.4 0 0 1 5.175-2.886M17.825 9.114A11 3.4 0 0 1 23 12" />
            <path d="M1 12a11 3.4 0 0 0 22 0" />
          </g>
        </>
      )}
      {symbol === "spirit" && (
        <>
          <circle cx="12" cy="5" r="2.7" fill={core} fillOpacity=".6" />
          <path
            d="M6.5 15c.5-4.4 2.5-6.3 5.5-6.3s5 1.9 5.5 6.3M12 17c-3-3.5-9-4-9 0 0 2.5 3 3.3 9 3.3s9-.8 9-3.3c0-4-6-3.5-9 0Z"
            fill={core}
            fillOpacity=".3"
          />
        </>
      )}
      {symbol === "divine" && (
        <>
          <path
            d="m12 2 1.9 4.1L18 8l-4.1 1.9L12 14l-1.9-4.1L6 8l4.1-1.9Z"
            fill={core}
            fillOpacity=".65"
          />
          <path
            d="M11 21c-5 0-8-3-8-7 4 0 7 2 8 7ZM13 21c5 0 8-3 8-7-4 0-7 2-8 7Z"
            fill={core}
            fillOpacity=".25"
          />
        </>
      )}
      {symbol === "void" && (
        <>
          <path
            d="M12 7.5c-2.6 0-4.5 2.2-4.5 4.8S9.6 17 12.3 17c1.8 0 3.3-.9 4.2-2.3-4.5.9-6.7-3.7-4.5-7.2Z"
            fill={core}
            fillOpacity=".5"
          />
          {/* 外圈完整环绕月牙；上方较粗，下方较细，月牙与虚线之间留白。 */}
          <g strokeDasharray="2 3">
            <path
              d="M3.34 7a10 10 0 0 1 17.32 0"
              strokeWidth={earned ? 1.9 : 1.5}
            />
            <path
              d="M20.66 7a10 10 0 0 1 0 10M3.34 17a10 10 0 0 1 0-10"
              strokeWidth={earned ? 1.5 : 1.2}
            />
            <path
              d="M20.66 17a10 10 0 0 1-17.32 0"
              strokeWidth={earned ? 1.1 : 0.9}
            />
          </g>
        </>
      )}
      {symbol === "lotus" && (
        <>
          <path
            d="M9.375 10.875C8.8 8.3 10 5 12 3c2 2 3.2 5.3 2.625 7.875"
            fill={core}
            fillOpacity=".5"
          />
          <path
            d="M6.25 15.875C4 14 3 10 3 7c6 0 9 5 9 11M17.75 15.875C20 14 21 10 21 7c-6 0-9 5-9 11"
            fill={core}
            fillOpacity=".22"
          />
          <path
            d="M12 18c-4-3-8-3-10-1 3 4 7 5 10 1Zm0 0c4-3 8-3 10-1-3 4-7 5-10 1Z"
            fill={core}
            fillOpacity=".3"
          />
        </>
      )}
      {(symbol === "flame" || symbol === "furnace") && (
        <>
          {symbol === "flame" ? (
            <path d={flame} fill={core} fillOpacity=".45" />
          ) : (
            <>
              <path d={furnace.body} fill={core} fillOpacity=".45" />
              <path d={furnace.details} />
            </>
          )}
          <text
            x="12"
            y="23"
            stroke="none"
            fill="currentColor"
            textAnchor="middle"
            fontSize={symbol === "furnace" || (days && days >= 100) ? 7.5 : 8.7}
            fontWeight="600"
            fontFamily="system-ui, sans-serif"
          >
            {days}
          </text>
        </>
      )}
    </svg>
  );
}
