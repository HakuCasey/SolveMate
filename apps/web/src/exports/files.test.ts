import { describe, expect, it, vi } from "vitest";
import { exportFilename, filenameError, saveToDirectory } from "./files";

describe("export filenames and directory writes", () => {
  it("uses local date and the requested format with safe object names", () => {
    const date = new Date(2026, 10, 13, 0, 1);
    expect(exportFilename("全科教师", "json", date)).toBe(
      "全科教师_2026-11-13.json",
    );
    expect(exportFilename("高等数学笔记", "pdf", date)).toBe(
      "高等数学笔记_2026-11-13.pdf",
    );
    expect(exportFilename("a/b:课程", "pdf", date)).toBe(
      "a_b_课程_2026-11-13.pdf",
    );
    expect(filenameError("../test.json")).not.toBe("");
    expect(filenameError("CON.json")).not.toBe("");
    expect(filenameError(`${"中".repeat(100)}.json`)).not.toBe("");
  });
  function directory(fail = false) {
    const write = vi.fn(),
      close = vi.fn(),
      abort = vi.fn(),
      removeEntry = vi.fn().mockResolvedValue(undefined);
    const fake = {
      name: "导出资料",
      removeEntry,
      getFileHandle: vi.fn(async (name, options) => {
        if (!options?.create) {
          if (name === "配置.json") return {};
          throw new DOMException("Not found", "NotFoundError");
        }
        return {
          createWritable: async () => {
            if (fail) throw new DOMException("Denied", "NotAllowedError");
            return { write, close, abort };
          },
        };
      }),
    };
    return {
      handle: fake as unknown as FileSystemDirectoryHandle,
      write,
      close,
      abort,
      removeEntry,
    };
  }
  it("keeps existing files and reports the name that was actually saved", async () => {
    const fake = directory(),
      signal = new AbortController().signal;
    const result = await saveToDirectory(
      fake.handle,
      "配置.json",
      new Blob(["{}"]),
      signal,
    );
    expect(result.filename).toBe("配置 (1).json");
    expect(fake.write).toHaveBeenCalledOnce();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.removeEntry).not.toHaveBeenCalled();
  });
  it("cleans only the new unfinished file when permission is lost", async () => {
    const fake = directory(true);
    await expect(
      saveToDirectory(
        fake.handle,
        "配置.json",
        new Blob(["{}"]),
        new AbortController().signal,
      ),
    ).rejects.toThrow("Denied");
    expect(fake.removeEntry).toHaveBeenCalledWith("配置 (1).json");
  });
});

it("streams a large backup into the chosen directory", async () => {
  const parts: number[][] = [];
  const output = {
    write: vi.fn(async (data: Uint8Array) => {
      parts.push([...data]);
    }),
    close: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  const directory = {
    name: "资料",
    getFileHandle: vi.fn(async (_name, options) => {
      if (!options?.create)
        throw new DOMException("Not found", "NotFoundError");
      return { createWritable: async () => output };
    }),
    removeEntry: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  await saveToDirectory(
    directory,
    "备份.zip",
    stream,
    new AbortController().signal,
  );
  expect(parts).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(output.close).toHaveBeenCalledOnce();
});

it("removes an incomplete backup when the download stream fails", async () => {
  const removeEntry = vi.fn().mockResolvedValue(undefined);
  const output = {
    write: vi.fn(),
    close: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  const directory = {
    name: "资料",
    removeEntry,
    getFileHandle: vi.fn(async (_name, options) => {
      if (!options?.create)
        throw new DOMException("Not found", "NotFoundError");
      return { createWritable: async () => output };
    }),
  } as unknown as FileSystemDirectoryHandle;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("Stream interrupted"));
    },
  });
  await expect(
    saveToDirectory(
      directory,
      "备份.zip",
      stream,
      new AbortController().signal,
    ),
  ).rejects.toThrow("Stream interrupted");
  expect(output.abort).toHaveBeenCalledOnce();
  expect(removeEntry).toHaveBeenCalledWith("备份.zip");
  expect(output.close).not.toHaveBeenCalled();
});
