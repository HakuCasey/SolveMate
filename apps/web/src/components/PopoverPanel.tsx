import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Popover } from "radix-ui";
import { X, type LucideIcon } from "lucide-react";
import styles from "./PopoverPanel.module.css";

type Props = Omit<ComponentPropsWithoutRef<typeof Popover.Content>, "title"> & {
  titleId?: string;
  width?: number;
  padding?: number;
  closeLabel?: string;
} & ({ title: ReactNode; icon: LucideIcon } | { title?: never; icon?: never });

/** 气泡外观和名称标题只在此维护；业务组件提供正文与操作。 */
export const PopoverPanel = forwardRef<HTMLDivElement, Props>(
  function PopoverPanel(
    {
      title,
      icon: Icon,
      titleId,
      width = 280,
      padding = 16,
      closeLabel,
      className = "",
      style,
      children,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const headingId = titleId ?? generatedId;
    return (
      <Popover.Content
        ref={ref}
        sideOffset={10}
        collisionPadding={12}
        {...props}
        aria-labelledby={title ? headingId : props["aria-labelledby"]}
        className={`${styles.panel} ${className}`}
        style={{ width, padding, ...style }}
      >
        {title && (
          <header className={styles.heading}>
            <h3 id={headingId}>
              {Icon && <Icon aria-hidden="true" />}
              <span>{title}</span>
            </h3>
            {closeLabel && (
              <Popover.Close className={styles.close} aria-label={closeLabel}>
                <X aria-hidden="true" />
              </Popover.Close>
            )}
          </header>
        )}
        <div className={styles.body} data-titled={!!title || undefined}>
          {children}
        </div>
        <Popover.Arrow className={styles.arrow} width={12} height={6} />
      </Popover.Content>
    );
  },
);
