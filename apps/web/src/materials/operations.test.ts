import { describe, expect, it, vi } from "vitest";
import type { Material } from "@solvemate/contracts";
import { courses, createInitialData } from "../data/catalog";
import {
  addSubject,
  createSubjectDirectory,
  removeSubject,
  renameSubject,
} from "../state/subjects";
import { LocalDataController } from "../storage/controller";
import { createMaterialOperations } from "./operations";

const record = (file: File, courseId: string | null) =>
  ({ id: file.name, courseId, revision: 1 }) as Material;
const file = (name: string) => new File(["%PDF-example"], name);
function setup() {
  let data = addSubject(
    createInitialData(),
    courses,
    "物理",
    "subject-physics",
  );
  const importFile = vi.fn(async (value: File, id: string) =>
    record(value, id || null),
  );
  const assignCourse = vi.fn(async (item: Material, id: string | null) => ({
    ...item,
    courseId: id,
    revision: item.revision + 1,
  }));
  const operations = createMaterialOperations({
    readSubjects: () => createSubjectDirectory(courses, data.subjects),
    importFile,
    assignCourse,
  });
  return {
    operations,
    importFile,
    assignCourse,
    change: (update: (previous: typeof data) => typeof data) => {
      data = update(data);
    },
  };
}
describe("material operations use the subject directory", () => {
  it("retains per-file results and retries only failed files after partial success", async () => {
    const test = setup(),
      first = file("first.pdf"),
      second = file("second.pdf"),
      progress = vi.fn(),
      saved = vi.fn();
    test.importFile
      .mockImplementationOnce(async (value, id) => record(value, id))
      .mockRejectedValueOnce(new Error("Service unavailable"));
    const result = await test.operations.importFiles(
      [first, second],
      "subject-physics",
      progress,
      saved,
    );
    expect(result.saved.map((item) => item.id)).toEqual([first.name]);
    expect(result.failed).toEqual([
      { file: second, message: "Service unavailable" },
    ]);
    expect(saved).toHaveBeenCalledTimes(1);
    const retry = await test.operations.importFiles(
      result.failed.map((item) => item.file),
      "subject-physics",
      progress,
      saved,
    );
    expect(retry.failed).toEqual([]);
    expect(test.importFile.mock.calls.map(([value]) => value.name)).toEqual([
      first.name,
      second.name,
      second.name,
    ]);
  });
  it("rejects deleted target subjects without creating an orphan file", async () => {
    const test = setup();
    test.change((data) => removeSubject(data, courses, "subject-physics"));
    const result = await test.operations.importFiles(
      [file("a.pdf")],
      "subject-physics",
      vi.fn(),
      vi.fn(),
    );
    expect(result.failed[0].message).toContain("已删除");
    expect(test.importFile).not.toHaveBeenCalled();
    await expect(
      test.operations.assignCourse(
        { id: "old", revision: 1 } as Material,
        "subject-physics",
        vi.fn(),
      ),
    ).rejects.toThrow("已删除");
    expect(test.assignCourse).not.toHaveBeenCalled();
  });
  it("preserves an already saved record and explains a deletion during upload", async () => {
    const test = setup(),
      saved = vi.fn();
    test.importFile.mockImplementationOnce(async (value, id) => {
      test.change((data) => removeSubject(data, courses, id));
      return record(value, id);
    });
    const result = await test.operations.importFiles(
      [file("a.pdf"), file("b.pdf")],
      "subject-physics",
      vi.fn(),
      saved,
    );
    expect(result.saved).toHaveLength(1);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].message).toContain("原文件已保存");
    expect(test.importFile).toHaveBeenCalledTimes(1);
  });
  it("keeps the chosen identifier when its title changes and supports unclassified transfers", async () => {
    const test = setup();
    test.importFile.mockImplementationOnce(async (value, id) => {
      test.change((data) => renameSubject(data, courses, id, "物理实验"));
      return record(value, id);
    });
    expect(
      (
        await test.operations.importFiles(
          [file("a.pdf")],
          "subject-physics",
          vi.fn(),
          vi.fn(),
        )
      ).failed,
    ).toEqual([]);
    const original = {
      id: "same-material",
      courseId: "subject-physics",
      revision: 3,
    } as Material;
    const moved = await test.operations.assignCourse(original, null, vi.fn());
    expect(moved).toMatchObject({
      id: original.id,
      courseId: null,
      revision: 4,
    });
  });
  it("reads a newly committed subject before a React render can update page props", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new LocalDataController({
      load: async () => null,
      save: () => gate,
    });
    controller.initialize(createInitialData());
    const committing = controller.commit((data) =>
      addSubject(data, courses, "物理", "subject-new"),
    );
    expect(controller.readData()?.subjects).toBeUndefined();
    release();
    await committing;
    const operations = createMaterialOperations({
      readSubjects: () =>
        createSubjectDirectory(courses, controller.readData()?.subjects),
      importFile: async (value, id) => record(value, id),
      assignCourse: vi.fn(),
    });
    const result = await operations.importFiles(
      [file("new.pdf")],
      "subject-new",
      vi.fn(),
      vi.fn(),
    );
    expect(result.failed).toEqual([]);
    expect(result.saved[0].courseId).toBe("subject-new");
  });
});
