export interface PageRange {
  start: number;
  end: number;
}

export function pageRanges(pages: number[]): PageRange[] {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: PageRange[] = [];
  for (const page of sorted) {
    const last = ranges.at(-1);
    if (last && page === last.end + 1) last.end = page;
    else ranges.push({ start: page, end: page });
  }
  return ranges;
}

export function pageRangeLabel({ start, end }: PageRange) {
  return start === end ? String(start) : `${start}–${end}`;
}

export function pageSelectionLabel(pages: number[]) {
  return `第 ${pageRanges(pages).map(pageRangeLabel).join("、")} 页`;
}

export function addPageRange(
  pages: number[],
  start: number,
  end: number,
  pageCount: number,
) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > pageCount
  )
    throw new Error(`页码应在 1 到 ${pageCount} 之间，结束页不能小于起始页。`);
  const next = new Set(pages);
  for (let page = start; page <= end; page += 1) next.add(page);
  if (next.size > 200) throw new Error("最多选择 200 页。");
  return [...next].sort((left, right) => left - right);
}

export function parsePageList(value: string, pageCount: number) {
  const text = value.trim();
  if (!text) throw new Error("请填写页码。");
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(text))
    throw new Error("请使用英文逗号分隔页码，如 12,15,17。");
  const pages = [
    ...new Set(text.split(",").map((item) => Number(item.trim()))),
  ];
  if (pages.length > 200) throw new Error("最多选择 200 页。");
  if (pages.some((page) => page < 1 || page > pageCount))
    throw new Error(`页码应在 1 到 ${pageCount} 之间。`);
  return pages.sort((left, right) => left - right);
}

export function removePageRange(pages: number[], range: PageRange) {
  return pages.filter((page) => page < range.start || page > range.end);
}
