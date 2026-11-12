import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { defaultTheme } from "./default";
import { colorVariables, type ThemeDefinition } from "./definition";
import { applyTheme, resolveTheme } from "./theme";

const customTheme: ThemeDefinition = {
  schemaVersion: 1,
  id: "forest",
  name: "森林",
  colors: {
    light: {
      accent: "#176b43",
      accentBackground: "#e8f5ec",
      placeholder: "#9aa99f",
    },
    dark: {
      accent: "#8ed9ac",
      accentBackground: "#203b2c",
      placeholder: "#7c9687",
    },
  },
};

describe("theme configuration", () => {
  it("provides complete default palettes and distinguishes light from dark", () => {
    for (const appearance of ["light", "dark"] as const) {
      const resolved = resolveTheme(defaultTheme, appearance);
      expect(resolved.issues).toEqual([]);
      expect(Object.keys(resolved.colors).sort()).toEqual(
        Object.keys(colorVariables).sort(),
      );
      expect(resolved.colors).toEqual(defaultTheme.colors[appearance]);
    }
    expect(defaultTheme.colors.light.placeholder).not.toBe(
      defaultTheme.colors.light.text,
    );
    expect(defaultTheme.colors.dark.placeholder).not.toBe(
      defaultTheme.colors.dark.text,
    );
  });

  it("merges a partial theme with defaults from the selected scheme without changing the defaults", () => {
    const before = structuredClone(defaultTheme);
    const light = resolveTheme(customTheme, "light");
    const dark = resolveTheme(customTheme, "dark");
    expect(light.issues).toEqual([]);
    expect(light.colors.accent).toBe("#176b43");
    expect(dark.colors.accent).toBe("#8ed9ac");
    expect(light.colors.surface).toBe(defaultTheme.colors.light.surface);
    expect(dark.colors.userMessageBackground).toBe(
      defaultTheme.colors.dark.userMessageBackground,
    );
    expect(defaultTheme).toEqual(before);
  });

  it("reports invalid CSS and unknown fields while retaining valid fields and usable defaults", () => {
    const resolved = resolveTheme(
      {
        ...customTheme,
        colors: {
          light: {
            ...customTheme.colors.light,
            surface: 'url("https://example.invalid/resource")',
            background: "red; display:none",
            text: "#12",
            notePaper: "#fffa",
            arbitraryCss: "#fff",
            __proto__: { injected: "#f00" },
          },
          dark: { text: "var(--untrusted)", border: "#abc" },
        },
      },
      "light",
    );
    expect(resolved.colors.surface).toBe(defaultTheme.colors.light.surface);
    expect(resolved.colors.background).toBe(
      defaultTheme.colors.light.background,
    );
    expect(resolved.colors.accent).toBe("#176b43");
    expect(resolved.colors.notePaper).toBe("#fffa");
    expect(resolved.colors).not.toHaveProperty("injected");
    expect(resolved.colors).not.toHaveProperty("arbitraryCss");
    expect(resolved.issues.length).toBeGreaterThan(0);
    expect(
      resolveTheme(
        { ...customTheme, colors: { light: {}, dark: null } },
        "dark",
      ).colors,
    ).toEqual(defaultTheme.colors.dark);
  });

  it("falls back to the full default theme for unsupported metadata", () => {
    for (const value of [
      null,
      [],
      { ...customTheme, schemaVersion: 2 },
      { ...customTheme, id: "invalid id" },
      { ...customTheme, name: " " },
      { ...customTheme, colors: [] },
    ]) {
      const resolved = resolveTheme(value, "dark");
      expect(resolved.id).toBe("default");
      expect(resolved.colors).toEqual(defaultTheme.colors.dark);
      expect(resolved.issues).not.toEqual([]);
    }
  });

  it("replaces all previous theme values, keeps unrelated styles and synchronizes browser appearance", () => {
    const properties = new Map<string, string>([["--unrelated", "keep"]]);
    const meta = { setAttribute: vi.fn() };
    const target = {
      style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        colorScheme: "",
      },
      dataset: {} as Record<string, string>,
      ownerDocument: { querySelector: () => meta },
    };
    applyTheme("dark", customTheme, target as unknown as HTMLElement);
    expect(target.dataset).toEqual({ theme: "forest", appearance: "dark" });
    expect(properties.get("--sm-accent")).toBe("#8ed9ac");
    applyTheme("light", defaultTheme, target as unknown as HTMLElement);
    for (const [key, variable] of Object.entries(colorVariables))
      expect(properties.get(variable)).toBe(
        defaultTheme.colors.light[key as keyof typeof colorVariables],
      );
    expect(properties.get("--unrelated")).toBe("keep");
    expect(target.style.colorScheme).toBe("light");
    expect(meta.setAttribute).toHaveBeenLastCalledWith(
      "content",
      defaultTheme.colors.light.background,
    );
    const logging = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(applyTheme("dark", null, target as unknown as HTMLElement).id).toBe(
      "default",
    );
    expect(logging).toHaveBeenCalledOnce();
    logging.mockRestore();
  });

  it("keeps component colors centralized and defines every application color variable", () => {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const base = readFileSync(join(root, "theme/base.css"), "utf8");
    const declared = new Set<string>([
      ...Object.values(colorVariables),
      ...Array.from(base.matchAll(/(--sm-[\w-]+)\s*:/g), (match) => match[1]),
    ]);
    const files = readdirSync(root, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".css"));
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      for (const match of source.matchAll(/var\((--sm-[\w-]+)/g))
        expect(declared.has(match[1]), `${file}: ${match[1]}`).toBe(true);
      if (file.split(/[\\/]/)[0] !== "theme")
        expect(source, file).not.toMatch(
          /#[\da-f]{3,8}\b|\blight-dark\(|\brgba?\(|:\s*(?:white|black)\b/i,
        );
    }
  });
});
