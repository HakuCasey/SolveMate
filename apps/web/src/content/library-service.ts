import type { AppData, ReadingSelection } from "@solvemate/contracts";
import type { InstalledCourse, InstallOptions } from "./storage";
import type { OfficialLibrary } from "./library";
import { removeSubject } from "../state/subjects";
import { DataRequestError } from "../refresh/errors";

interface Ports {
  read(): OfficialLibrary;
  refresh(): Promise<unknown>;
  load(): Promise<unknown>;
  install(
    courseId: string,
    update?: boolean,
    options?: InstallOptions,
  ): Promise<InstalledCourse | null>;
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
      let target = before.packageState.saved;
      if (update || !target || target.available === false) {
        const desiredVersion =
          !update && target
            ? target.version
            : before.packageState.latestVersion;
        const cached = this.ports
          .read()
          .snapshot.installed.find(
            (item) =>
              item.courseId === before.source.id &&
              item.version === desiredVersion &&
              item.available !== false,
          );
        if (cached && (!update || before.packageState.checked)) target = cached;
        else {
          // 先固定各条目原来的版本，再写入课程包，避免下载期间其他条目切换版本。
          await this.ports.save((data) => {
            const library = this.ports.read().withData(data);
            if (library.get(id).membershipKey !== before.membershipKey)
              throw new DataRequestError(
                "资料状态已变化，请重新选择后下载。",
                "official_material_changed",
                409,
              );
            return library.pinVersions(data, before.source.id);
          });
          const repairVersion =
            !update && target?.available === false ? target.version : undefined;
          const installed = await this.ports.install(before.source.id, update, {
            materialId: id,
            ...(repairVersion ? { repairVersion } : {}),
          });
          await this.ports.load();
          target =
            installed ??
            this.ports
              .read()
              .snapshot.installed.find(
                (item) =>
                  item.courseId === before.source.id &&
                  item.version === desiredVersion &&
                  item.available !== false &&
                  (item.version !== before.version ||
                    !before.packageState.saved ||
                    before.packageState.saved.available === false),
              );
        }
      }
      if (!target) return false;
      const version = target.version;
      await this.ports.save((data) => {
        const library = this.ports.read().withData(data);
        if (library.get(id).membershipKey !== before.membershipKey)
          throw new DataRequestError(
            "下载期间资料归属、版本或删除状态已变化，请核对后重新添加。",
            "official_material_changed",
            409,
          );
        return library.restore(data, id, version, Date.now());
      });
      return true;
    });
  remove = (id: string) =>
    this.run(async () => {
      await this.ports.refresh();
      await this.ports.save((data) =>
        this.ports.read().withData(data).remove(data, id),
      );
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
