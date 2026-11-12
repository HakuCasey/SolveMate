import type { AppData, ReadingSelection } from "@solvemate/contracts";
import type { InstalledCourse } from "./storage";
import type { OfficialLibrary } from "./library";
import { removeSubject } from "../state/subjects";
import { DataRequestError } from "../refresh/errors";

interface Ports {
  read(): OfficialLibrary;
  refresh(): Promise<unknown>;
  load(): Promise<unknown>;
  install(courseId: string, update?: boolean): Promise<InstalledCourse | null>;
  save(change: (data: AppData) => AppData): Promise<AppData>;
}

/** 修改规则不属于页面；保存失败保留条目状态，已经下载的包不回滚或删除。 */
export class OfficialLibraryService {
  private state = { busy: false, error: "" };
  private listeners = new Set<() => void>();
  constructor(private readonly ports: Ports) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<typeof this.state>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state.busy) throw new Error("请等待当前资料操作完成。");
    this.publish({ busy: true, error: "" });
    try {
      return await operation();
    } catch (error) {
      this.publish({
        error:
          error instanceof Error ? error.message : "资料操作失败，请重试。",
      });
      throw error;
    } finally {
      this.publish({ busy: false });
    }
  }
  acquire = (id: string, update = false) =>
    this.run(async () => {
      await this.ports.refresh();
      const before = this.ports.read().get(id);
      if (
        update ||
        !before.packageState.saved ||
        before.packageState.saved.available === false
      ) {
        const installed = await this.ports.install(before.source.id, update);
        await this.ports.load();
        if (
          !installed &&
          (before.packageState.saved ||
            !this.ports.read().get(id).packageState.saved)
        )
          return false;
      }
      await this.ports.save((data) => {
        const library = this.ports.read();
        if (library.get(id).membershipKey !== before.membershipKey)
          throw new DataRequestError(
            "下载期间资料归属或删除状态已变化，请核对后重新添加。",
            "official_material_changed",
            409,
          );
        return library.restore(data, id);
      });
      return true;
    });
  remove = (id: string) =>
    this.run(async () => {
      await this.ports.refresh();
      await this.ports.save((data) => this.ports.read().remove(data, id));
    });
  removeSubject = (id: string) =>
    this.run(async () => {
      await this.ports.refresh();
      await this.ports.save((data) =>
        removeSubject(data, this.ports.read().snapshot.activeCourses, id),
      );
    });
  read = async (
    id: string,
    previous?: ReadingSelection,
    requireDownload = false,
  ) => {
    if (this.state.busy) throw new Error("请等待当前资料操作完成后再阅读。");
    await this.ports.refresh();
    const item = this.ports.read().get(id);
    if (requireDownload && !item.downloaded)
      throw new Error("资料已删除或本地文件不可用，请重新添加后再阅读。");
    return item.selection(previous);
  };
}
