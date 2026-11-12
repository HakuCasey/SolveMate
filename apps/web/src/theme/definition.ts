/** 主题只配置颜色；组件的布局、字号与交互不由主题改写。 */
export const colorVariables = {
  surface: "--sm-paper",
  background: "--sm-ground",
  text: "--sm-ink",
  mutedText: "--sm-soft",
  placeholder: "--sm-placeholder",
  border: "--sm-line",
  accent: "--sm-accent",
  accentBackground: "--sm-active",
  onAccent: "--sm-on",
  danger: "--sm-danger",
  dangerBackground: "--sm-danger-background",
  onDanger: "--sm-on-danger",
  success: "--sm-success",
  userMessageBackground: "--sm-chat-user-background",
  userMessageBorder: "--sm-chat-user-border",
  assistantMessageBackground: "--sm-chat-assistant-background",
  codeBackground: "--sm-code-background",
  codeText: "--sm-code-text",
  selection: "--sm-selection",
  notePaper: "--sm-note-paper",
  noteDot: "--sm-note-dot",
  noteMargin: "--sm-note-margin",
  noteHole: "--sm-note-hole",
  noteInset: "--sm-note-inset",
  shadow: "--sm-shadow-color",
  shadowSoft: "--sm-shadow-soft-color",
  overlay: "--sm-overlay",
} as const;

export type Appearance = Settings["appearance"];
export type ThemeColor = keyof typeof colorVariables;
export type ThemeColors = Record<ThemeColor, string>;
export interface ThemeDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  colors: Record<Appearance, Partial<ThemeColors>>;
}
import type { Settings } from "@solvemate/contracts";
