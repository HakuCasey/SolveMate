import { describe, expect, it, vi } from "vitest";
import { detectConnection } from "./detect-connection";
import { LocalAiError, type Detection } from "./local-api";

const connected = {
  currentModel: "actual-model",
  models: [],
} as unknown as Detection;
const missing = () => new LocalAiError("找不到程序", "program_missing");

describe("Harness connection fallback", () => {
  it("uses a registered command without filling an installation path", async () => {
    const probe = vi.fn().mockResolvedValue(connected);
    const fill = vi.fn();
    expect(
      await detectConnection("", "model", "/default.app", fill, probe),
    ).toBe(connected);
    expect(probe).toHaveBeenCalledExactlyOnceWith("", "model");
    expect(fill).not.toHaveBeenCalled();
  });

  it.each([
    "/Applications/DeepSeek Harness.app",
    String.raw`D:\用户 空间\Programs\DeepSeek Harness`,
  ])("fills %s before trying that default once", async (path) => {
    let visiblePath = "";
    const probe = vi
      .fn()
      .mockRejectedValueOnce(missing())
      .mockImplementationOnce(async (value) => {
        expect(visiblePath).toBe(path);
        expect(value).toBe(path);
        return connected;
      });
    expect(
      await detectConnection(
        "",
        "",
        path,
        (value) => {
          visiblePath = value;
        },
        probe,
      ),
    ).toBe(connected);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps an unavailable default visible and gives an action instead of retrying again", async () => {
    const probe = vi.fn().mockRejectedValue(missing());
    const fill = vi.fn();
    await expect(
      detectConnection("", "", "/default.app", fill, probe),
    ).rejects.toMatchObject({
      code: "program_missing",
      message: expect.stringContaining("请填写实际安装路径"),
    });
    expect(fill).toHaveBeenCalledExactlyOnceWith("/default.app");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not replace a user path or conceal a model configuration error", async () => {
    const fill = vi.fn();
    const explicit = vi.fn().mockRejectedValue(missing());
    await expect(
      detectConnection("/custom.app", "", "/default.app", fill, explicit),
    ).rejects.toMatchObject({ code: "program_missing" });
    const failure = new LocalAiError("模型配置损坏", "model_config_invalid");
    const automatic = vi.fn().mockRejectedValue(failure);
    await expect(
      detectConnection("", "", "/default.app", fill, automatic),
    ).rejects.toBe(failure);
    expect(explicit).toHaveBeenCalledTimes(1);
    expect(automatic).toHaveBeenCalledTimes(1);
    expect(fill).not.toHaveBeenCalled();
  });

  it("allows the next detection to succeed after an installation change", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(missing())
      .mockRejectedValueOnce(missing())
      .mockResolvedValueOnce(connected);
    await expect(
      detectConnection("", "", "/default.app", vi.fn(), probe),
    ).rejects.toBeInstanceOf(LocalAiError);
    expect(
      await detectConnection("/moved.app", "", "/default.app", vi.fn(), probe),
    ).toBe(connected);
    expect(probe).toHaveBeenLastCalledWith("/moved.app", "");
  });
});
