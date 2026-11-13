import { describe, expect, it } from "vitest";
import { LocalAiError, submissionIsUncertain } from "./errors";

describe("AI submission confirmation", () => {
  it.each([
    "request_timeout",
    "local_service_unavailable",
    "contract_invalid",
    "turn_mismatch",
    "http_502",
    "http_503",
  ])("does not turn %s into permission to submit again", (code) => {
    expect(
      submissionIsUncertain(
        new LocalAiError("失败", code),
        new LocalAiError("查询失败"),
      ),
    ).toBe(true);
  });
  it("allows a manual retry after an authoritative missing-record response, or a definite rejection", () => {
    expect(
      submissionIsUncertain(
        new LocalAiError("超时", "request_timeout"),
        new LocalAiError("不存在", "http_404"),
      ),
    ).toBe(false);
    expect(
      submissionIsUncertain(new LocalAiError("模型不可用", "model_missing")),
    ).toBe(false);
    expect(submissionIsUncertain(new Error("Unknown failure"))).toBe(true);
  });
});
