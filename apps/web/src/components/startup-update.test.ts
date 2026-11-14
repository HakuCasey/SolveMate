import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StartupUpdate } from "./StartupUpdate";

it("always offers a direct reopen action before records or update states are available", () => {
  const html = renderToStaticMarkup(createElement(StartupUpdate));
  expect(html).toContain('aria-label="重新打开应用"');
  expect(html).toContain("更新并重新打开");
  expect(html).not.toContain("disabled");
});
