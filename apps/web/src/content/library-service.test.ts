import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryFixture } from "./library.test-support";
import { OfficialLibrary } from "./library";
import { OfficialLibraryService } from "./library-service";
import { materialApi } from "../materials/api";
afterEach(() => vi.restoreAllMocks());
describe("community acquisition delegates to the shared material service", () => {
  it("reactivates only the selected material with its revision", async () => {
    const { data, snapshot } = await libraryFixture();
    const item = data.materials[0];
    item.deletedAt = 200;
    const activate = vi.spyOn(materialApi, "activate").mockResolvedValue(item);
    const refresh = vi.fn(async () => undefined);
    const service = new OfficialLibraryService({
      read: () => new OfficialLibrary(snapshot, data),
      refresh,
      load: refresh,
      install: vi.fn(),
    });
    await service.acquire(item.id);
    expect(activate).toHaveBeenCalledExactlyOnceWith(item, item.currentVersion);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("reports persistence failure without rewriting metadata in app records", async () => {
    const { data, snapshot } = await libraryFixture();
    const before = structuredClone(data);
    vi.spyOn(materialApi, "activate").mockRejectedValue(
      new Error("Disk unavailable"),
    );
    const service = new OfficialLibraryService({
      read: () => new OfficialLibrary(snapshot, data),
      refresh: async () => {},
      load: async () => {},
      install: vi.fn(),
    });
    await expect(service.acquire(data.materials[0].id)).rejects.toThrow(
      "Disk unavailable",
    );
    expect(data).toEqual(before);
    expect(service.snapshot()).toEqual({
      busy: false,
      error: "Disk unavailable",
    });
  });
});
