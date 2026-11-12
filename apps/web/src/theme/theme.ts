import { logError } from "../logger";
import { defaultTheme } from "./default";
import {
  colorVariables,
  type Appearance,
  type ThemeColors,
} from "./definition";

interface ResolvedTheme {
  id: string;
  name: string;
  colors: ThemeColors;
  issues: string[];
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 配色仅接受十六进制颜色，不能通过主题字段注入 CSS 规则或外部资源。 */
export function resolveTheme(
  input: unknown,
  appearance: Appearance,
): ResolvedTheme {
  const colors: ThemeColors = { ...defaultTheme.colors[appearance] };
  const issues: string[] = [];
  if (
    !isObject(input) ||
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(input.id) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100 ||
    !isObject(input.colors)
  ) {
    return {
      id: defaultTheme.id,
      name: defaultTheme.name,
      colors,
      issues: ["Invalid theme metadata or unsupported schema version."],
    };
  }
  for (const field of Object.keys(input))
    if (!["schemaVersion", "id", "name", "colors"].includes(field))
      issues.push("Unknown theme metadata field.");
  for (const mode of Object.keys(input.colors))
    if (mode !== "light" && mode !== "dark")
      issues.push("Unknown theme color scheme.");
  // 两组配色都检查，避免某种模式中的错误直到切换时才被发现。
  for (const mode of ["light", "dark"] as const) {
    const palette = input.colors[mode];
    if (!isObject(palette)) {
      issues.push(`Missing or invalid ${mode} color palette.`);
      continue;
    }
    for (const [key, value] of Object.entries(palette)) {
      if (!Object.hasOwn(colorVariables, key)) {
        issues.push(`Unknown color field in ${mode} palette.`);
      } else if (
        typeof value !== "string" ||
        !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      ) {
        issues.push(`Invalid ${mode} color: ${key}.`);
      } else if (mode === appearance) {
        colors[key as keyof ThemeColors] = value;
      }
    }
  }
  return { id: input.id, name: input.name.trim(), colors, issues };
}

/** 校验完全部颜色后再更新，切换主题时完整覆盖上一主题的变量。 */
export function applyTheme(
  appearance: Appearance,
  input: unknown = defaultTheme,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const resolved = resolveTheme(input, appearance);
  if (resolved.issues.length)
    logError(
      "Invalid theme configuration; default colors were used where needed.",
      new TypeError("InvalidTheme"),
    );
  for (const key of Object.keys(colorVariables) as (keyof ThemeColors)[])
    root.style.setProperty(colorVariables[key], resolved.colors[key]);
  root.dataset.theme = resolved.id;
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
  root.ownerDocument
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved.colors.background);
  return resolved;
}
