import { describe, expect, it, vi } from "vitest";
import { OfficialLibrary } from "./library";
import { OfficialLibraryService } from "./library-service";
import { libraryFixture } from "./library.test-support";
import { removeSubject } from "../state/subjects";
import { courses } from "../data/catalog";
import type { AppData } from "@solvemate/contracts";

const id = "calculus:textbooks:B001";
async function setup() {
  const fixture = await libraryFixture();
  let data = new OfficialLibrary(fixture.snapshot, fixture.data).remove(
    fixture.data,
    id,
    200,
  );
  const ports = {
    read: () => new OfficialLibrary(fixture.snapshot, data),
    refresh: vi.fn(async () => undefined),
    load: vi.fn(async () => fixture.snapshot),
    install: vi.fn(async () => fixture.saved),
    save: vi.fn(
      async (change: (value: AppData) => AppData) => (data = change(data)),
    ),
  };
  return {
    fixture,
    ports,
    service: new OfficialLibraryService(ports),
    getData: () => data,
    setData: (next: AppData) => {
      data = next;
    },
  };
}

describe("official library service", () => {
  it("re-adds a verified local package without another download", async () => {
    const { ports, service } = await setup();
    expect(await service.acquire(id)).toBe(true);
    expect(ports.install).not.toHaveBeenCalled();
    expect(ports.save).toHaveBeenCalledOnce();
    expect(ports.read().get(id).downloaded).toBe(true);
    expect(service.snapshot()).toEqual({ busy: false, error: "" });
  });
  it("keeps removal metadata when saving the restored entry fails", async () => {
    const { ports, service, getData } = await setup();
    ports.save.mockRejectedValueOnce(new Error("Save failed"));
    await expect(service.acquire(id)).rejects.toThrow("Save failed");
    expect(getData().officialMaterials?.[0].deletedAt).toBe(200);
    expect(ports.read().get(id).downloaded).toBe(false);
    expect(service.snapshot().error).toBe("Save failed");
    expect(service.snapshot().busy).toBe(false);
  });
  it("does not undo a deletion received while a package update is running", async () => {
    const { ports, service, fixture, setData, getData } = await setup();
    setData(fixture.data);
    ports.install.mockImplementation(async () => {
      setData(removeSubject(getData(), courses, "calculus"));
      return fixture.saved;
    });
    await expect(service.acquire(id, true)).rejects.toThrow("删除状态已变化");
    expect(
      getData().subjects?.find((subject) => subject.id === "calculus")?.deleted,
    ).toBe(true);
    expect(
      getData().officialMaterials?.every(
        (item) => item.version === fixture.saved.version,
      ),
    ).toBe(true);
  });
  it("checks the latest metadata before opening a stale reading button", async () => {
    const { ports, service, fixture, setData } = await setup();
    setData(fixture.data);
    ports.refresh.mockImplementation(async () => {
      setData(removeSubject(fixture.data, courses, "calculus"));
    });
    await expect(service.read(id, undefined, true)).rejects.toThrow("已删除");
    expect(ports.install).not.toHaveBeenCalled();
    expect(ports.save).not.toHaveBeenCalled();
  });
  it("allows history-preserving removal without changing content files", async () => {
    const { ports, service, fixture, setData, getData } = await setup();
    setData(fixture.data);
    await service.remove(id);
    expect(ports.read().get(id).removed).toBe(true);
    expect(getData().conversations).toBe(fixture.data.conversations);
    expect(fixture.snapshot.installed[0].archive).toBe(fixture.saved.archive);
    expect(ports.install).not.toHaveBeenCalled();
  });
  it("does not mutate entries if fresh records cannot be read", async () => {
    const { ports, service } = await setup();
    ports.refresh.mockRejectedValueOnce(new Error("Offline"));
    await expect(service.acquire(id)).rejects.toThrow("Offline");
    expect(ports.save).not.toHaveBeenCalled();
  });
});

it("repairs a missing package file from the verified copy before restoring metadata", async () => {
  const { ports, service, fixture } = await setup();
  fixture.saved.available = false;
  ports.install.mockImplementation(async () => {
    fixture.saved.available = true;
    return fixture.saved;
  });
  await service.acquire(id);
  expect(ports.install).toHaveBeenCalledWith("calculus", false, {
    materialId: id,
    repairVersion: fixture.saved.version,
  });
  expect(ports.load).toHaveBeenCalledOnce();
  expect(ports.read().get(id).downloaded).toBe(true);
});
