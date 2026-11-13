import { useState, type ReactElement } from "react";
import { Popover } from "radix-ui";
import { Brain } from "lucide-react";
import type { Robot, RobotAiDefaults } from "@solvemate/contracts";
import type { AiService } from "../ai/useAiService";
import { PopoverPanel } from "./PopoverPanel";
import { AiSelectionForm } from "./AiSelectionForm";

/** 选择气泡属于当前对话，不依赖侧栏设置菜单的状态或定位。 */
export function AiSelectionPopover({
  robot,
  saved,
  scopeId,
  ai,
  onSave,
  children,
}: {
  robot: Robot;
  saved: RobotAiDefaults;
  scopeId: string;
  ai: AiService;
  onSave: (config: RobotAiDefaults) => Promise<void>;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void ai.refresh();
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <PopoverPanel
          title="AI 选择"
          icon={Brain}
          width={320}
          side="bottom"
          align="end"
          onInteractOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("[data-settings-select]")
            )
              event.preventDefault();
          }}
        >
          <AiSelectionForm
            key={scopeId}
            scopeId={scopeId}
            robot={robot}
            saved={saved}
            settings={ai.settings}
            onSave={async (config) => {
              await onSave(config);
              setOpen(false);
            }}
          />
        </PopoverPanel>
      </Popover.Portal>
    </Popover.Root>
  );
}
