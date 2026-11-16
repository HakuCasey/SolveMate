import type { ReactElement } from "react";
import type { CommunityCatalogEntry } from "../content/library";
import type { SubjectDirectory } from "../state/subjects";
import { MaterialActions } from "../materials/MaterialActions";
import type { PersonalMaterials } from "../materials/useMaterials";

/** 社区目录中的本地资料仍由同一个资料服务管理。未添加的目录项只有下载操作。 */
export function OfficialContentActions({
  item,
  directory,
  library,
  children,
}: {
  item: CommunityCatalogEntry;
  directory: SubjectDirectory;
  library: PersonalMaterials;
  children: ReactElement;
}) {
  return item.metadata ? (
    <MaterialActions
      item={item.metadata}
      directory={directory}
      library={library}
    >
      {children}
    </MaterialActions>
  ) : (
    children
  );
}
