import { useId } from "react";
import { Select } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./SettingsSelect.module.css";

interface SettingsSelectProps {
  label: string;
  className?: string;
  value: string;
  options: {
    value: string;
    name: string;
    group?: string;
    disabled?: boolean;
    emphasized?: boolean;
  }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** 使用页面主题绘制选项列表，避免系统原生菜单与应用外观不一致。 */
export function SettingsSelect({
  label,
  className = "",
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "请选择",
}: SettingsSelectProps) {
  const id = useId();
  const groups = [...new Set(options.map((option) => option.group ?? ""))];

  function items(group: string) {
    return options
      .filter((option) => (option.group ?? "") === group)
      .map((option) => (
        <Select.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={styles.item}
          data-emphasized={option.emphasized || undefined}
        >
          <Select.ItemText>{option.name}</Select.ItemText>
          <Select.ItemIndicator className={styles.indicator}>
            <Check aria-hidden="true" />
          </Select.ItemIndicator>
        </Select.Item>
      ));
  }

  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <Select.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <Select.Trigger
          id={id}
          aria-label={label}
          className={styles.trigger}
          data-emphasized={
            options.find((option) => option.value === value)?.emphasized ||
            undefined
          }
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon className={styles.chevron}>
            <ChevronDown aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className={styles.menu}
            data-settings-select=""
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <Select.ScrollUpButton className={styles.scrollButton}>
              <ChevronUp aria-hidden="true" />
            </Select.ScrollUpButton>
            <Select.Viewport className={styles.viewport}>
              {groups.map((group) =>
                group ? (
                  <Select.Group key={`group:${group}`}>
                    <Select.Label className={styles.groupLabel}>
                      {group}
                    </Select.Label>
                    {items(group)}
                  </Select.Group>
                ) : (
                  <Select.Group key="ungrouped">{items(group)}</Select.Group>
                ),
              )}
            </Select.Viewport>
            <Select.ScrollDownButton className={styles.scrollButton}>
              <ChevronDown aria-hidden="true" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
