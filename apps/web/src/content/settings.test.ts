import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT_SERVICE_URL,
  contentApiBase,
  contentServiceUrlError,
  getContentServiceUrl,
  normalizeContentServiceUrl,
  setContentServiceUrl,
  subscribeContentServiceUrl,
} from "./settings";

beforeEach(() => setContentServiceUrl(undefined));
afterEach(() => setContentServiceUrl(undefined));

describe("content service address", () => {
  it("accepts empty values, site-relative paths and http(s) addresses", () => {
    expect(contentServiceUrlError("")).toBeNull();
    expect(contentServiceUrlError("   ")).toBeNull();
    expect(contentServiceUrlError("/api/v1")).toBeNull();
    expect(
      contentServiceUrlError("https://content.example.com/api/v1"),
    ).toBeNull();
    expect(contentServiceUrlError("http://127.0.0.1:8000/api/v1")).toBeNull();
  });

  it("rejects addresses without a supported scheme", () => {
    expect(contentServiceUrlError("content.example.com")).not.toBeNull();
    expect(contentServiceUrlError("ftp://content.example.com")).not.toBeNull();
    expect(
      contentServiceUrlError("//content.example.com/api/v1"),
    ).not.toBeNull();
    expect(
      contentServiceUrlError("https://name:secret@content.example.com/api/v1"),
    ).not.toBeNull();
    expect(
      contentServiceUrlError("https://content.example.com/api/v1?token=secret"),
    ).not.toBeNull();
    expect(contentServiceUrlError("不是地址")).not.toBeNull();
  });

  it("normalizes trailing slashes and treats empty values as unset", () => {
    expect(normalizeContentServiceUrl(undefined)).toBeUndefined();
    expect(normalizeContentServiceUrl("   ")).toBeUndefined();
    expect(normalizeContentServiceUrl("  /api/v1/  ")).toBe("/api/v1");
    expect(
      normalizeContentServiceUrl("https://content.example.com/api/v1/"),
    ).toBe("https://content.example.com/api/v1");
    expect(normalizeContentServiceUrl("/")).toBeUndefined();
    expect(normalizeContentServiceUrl("坏地址")).toBeUndefined();
  });

  it("falls back to the built-in default when nothing is configured", () => {
    expect(contentApiBase(undefined)).toBe(DEFAULT_CONTENT_SERVICE_URL);
    expect(contentApiBase("")).toBe(DEFAULT_CONTENT_SERVICE_URL);
    expect(contentApiBase("https://content.example.com/api/v1")).toBe(
      "https://content.example.com/api/v1",
    );
  });

  it("notifies subscribers only when the stored address changes", () => {
    const listen = vi.fn();
    const stop = subscribeContentServiceUrl(listen);

    setContentServiceUrl("https://content.example.com/api/v1");
    expect(listen).toHaveBeenCalledTimes(1);
    expect(getContentServiceUrl()).toBe("https://content.example.com/api/v1");

    setContentServiceUrl("https://content.example.com/api/v1/");
    expect(listen).toHaveBeenCalledTimes(1);

    setContentServiceUrl("");
    expect(listen).toHaveBeenCalledTimes(2);
    expect(getContentServiceUrl()).toBeUndefined();

    stop();
    setContentServiceUrl("https://another.example.com/api/v1");
    expect(listen).toHaveBeenCalledTimes(2);
  });
});
