import { useState } from "react";
import { Link } from "lucide-react";
import { Popover } from "radix-ui";
import { PopoverPanel } from "./PopoverPanel";
import {
  addPageRange,
  pageRanges,
  parsePageList,
} from "../reading/page-selection";
import styles from "./ReadingContextControl.module.css";

export interface ReadingPageSelection {
  currentPage: number;
  pageCount: number;
  pages: number[];
  customized: boolean;
  onChange: (pages: number[] | null) => void;
}

type SelectionMode = "pages" | "range";

function initialForm(selection: ReadingPageSelection) {
  const ranges = pageRanges(selection.pages);
  const useRange =
    selection.customized &&
    ranges.length === 1 &&
    ranges[0].start !== ranges[0].end;
  return {
    mode: (useRange ? "range" : "pages") as SelectionMode,
    pages: selection.customized && !useRange ? selection.pages.join(",") : "",
    start: useRange ? String(ranges[0].start) : "",
    end: useRange ? String(ranges[0].end) : "",
  };
}

export function ReadingContextControl({
  label,
  selection,
}: {
  label: string;
  selection: ReadingPageSelection;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SelectionMode>("pages");
  const [pages, setPages] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");

  function changeOpen(next: boolean) {
    if (next) {
      const form = initialForm(selection);
      setMode(form.mode);
      setPages(form.pages);
      setStart(form.start);
      setEnd(form.end);
      setError("");
    }
    setOpen(next);
  }

  function confirm() {
    try {
      const selected =
        mode === "pages"
          ? parsePageList(pages, selection.pageCount)
          : addPageRange([], Number(start), Number(end), selection.pageCount);
      selection.onChange(selected);
      changeOpen(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "无法保存参考页码。",
      );
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger className={styles.trigger} title={label}>
        <Link aria-hidden="true" />
        <span>{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          aria-label="参考页码"
          side="top"
          align="start"
          padding={10}
          maxWidth={380}
        >
          <label className={styles.optionRow}>
            <input
              type="radio"
              name="reading-page-selection"
              checked={mode === "pages"}
              onChange={() => {
                setMode("pages");
                setError("");
              }}
            />
            <span>已选页码</span>
            <input
              className={styles.pageList}
              aria-label="已选页码"
              inputMode="numeric"
              value={pages}
              placeholder="12,15,17"
              onFocus={() => setMode("pages")}
              onChange={(event) => setPages(event.target.value)}
            />
          </label>
          <label className={`${styles.optionRow} ${styles.rangeRow}`}>
            <input
              type="radio"
              name="reading-page-selection"
              checked={mode === "range"}
              onChange={() => {
                setMode("range");
                setError("");
              }}
            />
            <span>页码范围</span>
            <input
              className={styles.pageNumber}
              aria-label="起始页"
              inputMode="numeric"
              value={start}
              placeholder={String(selection.currentPage)}
              onFocus={() => setMode("range")}
              onChange={(event) => setStart(event.target.value)}
            />
            <span aria-hidden="true">-</span>
            <input
              className={styles.pageNumber}
              aria-label="结束页"
              inputMode="numeric"
              value={end}
              placeholder={String(
                Math.min(selection.currentPage + 3, selection.pageCount),
              )}
              onFocus={() => setMode("range")}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.follow}
              onClick={() => {
                selection.onChange(null);
                changeOpen(false);
              }}
            >
              跟随
            </button>
            <button type="button" onClick={() => changeOpen(false)}>
              取消
            </button>
            <button type="button" className={styles.confirm} onClick={confirm}>
              确认
            </button>
          </div>
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
