import {
  forwardRef,
  useId,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Popover } from "radix-ui";
import { X, type LucideIcon } from "lucide-react";
import styles from "./PopoverPanel.module.css";

type Props = Omit<ComponentPropsWithoutRef<typeof Popover.Content>, "title"> & {
  titleId?: string;
  width?: number;
  maxWidth?: number;
  padding?: number;
  closeLabel?: string;
} & ({ title: ReactNode; icon: LucideIcon } | { title?: never; icon?: never });

const narrowScreen = "(max-width: 740px)";
const isNarrowScreen = () => window.matchMedia(narrowScreen).matches;
function subscribeToScreenSize(notify: () => void) {
  const media = window.matchMedia(narrowScreen);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

/** 气泡外观和名称标题只在此维护；业务组件提供正文与操作。 */
export const PopoverPanel = forwardRef<HTMLDivElement, Props>(
  function PopoverPanel(
    {
      title,
      icon: Icon,
      titleId,
      width,
      maxWidth = width ?? 280,
      padding = 16,
      closeLabel,
      side,
      className = "",
      style,
      children,
      ...props
    },
    ref,
  ) {
    const narrow = useSyncExternalStore(
      subscribeToScreenSize,
      isNarrowScreen,
      () => false,
    );
    const horizontal = side === "left" || side === "right";
    const generatedId = useId();
    const headingId = titleId ?? generatedId;
    return (
      <Popover.Content
        ref={ref}
        side={narrow && horizontal ? "top" : side}
        sideOffset={10}
        collisionPadding={12}
        {...props}
        aria-labelledby={title ? headingId : props["aria-labelledby"]}
        className={`${styles.panel} ${className}`}
        style={{
          width: width ?? "max-content",
          maxWidth: `min(${maxWidth}px, calc(100vw - 24px))`,
          padding,
          ...style,
        }}
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
