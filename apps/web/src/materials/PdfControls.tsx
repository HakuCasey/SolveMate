import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, ZoomIn, ZoomOut } from "lucide-react";
import { Popover, Switch } from "radix-ui";
import { PopoverPanel } from "../components/PopoverPanel";
import styles from "./MaterialReader.module.css";

/** 官方资料和上传资料共用翻页与缩放控件，阅读位置由各自的固定版本保存。 */
export function PdfControls({
  pageNumber,
  pageCount,
  onPageChange,
  zoom,
  onZoomChange,
  continuous,
  onContinuousChange,
}: {
  pageNumber: number;
  pageCount: number;
  onPageChange: (pageNumber: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  continuous: boolean;
  onContinuousChange: (continuous: boolean) => void;
}) {
  const [input, setInput] = useState(String(pageNumber));
  useEffect(() => setInput(String(pageNumber)), [pageNumber]);
  function go(value: number) {
    if (Number.isInteger(value) && value >= 1 && value <= pageCount) {
      if (value !== pageNumber) onPageChange(value);
    } else setInput(String(pageNumber));
  }
  return (
    <footer className={styles.navigation}>
      <Popover.Root>
        <Popover.Trigger
          className={styles.displaySettingsTrigger}
          aria-label="阅读设置"
          title="阅读设置"
        >
          <Eye aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <PopoverPanel
            title="阅读设置"
            icon={Eye}
            width={240}
            side="top"
            align="start"
          >
            <div className={styles.displaySetting}>
              <span>页面连续</span>
              <Switch.Root
                className={styles.continuousSwitch}
                aria-label="页面连续"
                checked={continuous}
                onCheckedChange={onContinuousChange}
              >
                <Switch.Thumb className={styles.switchThumb} />
              </Switch.Root>
            </div>
          </PopoverPanel>
        </Popover.Portal>
      </Popover.Root>
      <div className={styles.pageNavigation} role="group" aria-label="资料翻页">
        <button
          aria-label="上一页"
          title="上一页"
          disabled={pageNumber <= 1}
          onClick={() => go(pageNumber - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          <span className={styles.pageLabel}>上一页</span>
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go(Number(input));
          }}
        >
          <input
            aria-label="资料页码"
            type="number"
            min={1}
            max={pageCount}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => go(Number(input))}
          />
          <span>/ {pageCount}</span>
        </form>
        <button
          aria-label="下一页"
          title="下一页"
          disabled={pageNumber >= pageCount}
          onClick={() => go(pageNumber + 1)}
        >
          <span className={styles.pageLabel}>下一页</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className={styles.zoomControls} role="group" aria-label="资料缩放">
        <button
          aria-label="缩小资料"
          title="缩小资料"
          disabled={zoom <= 0.5}
          onClick={() => onZoomChange(Math.max(0.5, zoom - 0.25))}
        >
          <ZoomOut aria-hidden="true" />
        </button>
        <button
          onClick={() => onZoomChange(1)}
          aria-label="适应栏宽"
          title="适应栏宽"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="放大资料"
          title="放大资料"
          disabled={zoom >= 3}
          onClick={() => onZoomChange(Math.min(3, zoom + 0.25))}
        >
          <ZoomIn aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
