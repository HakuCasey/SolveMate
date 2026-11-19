import styles from "./FileLabel.module.css";

/** 路径和文件名只占一行，保留完整文本供悬停查看和复制。 */
export function FileLabel({ value, id }: { value: string; id?: string }) {
  return (
    <span className={styles.label} id={id} title={value}>
      {value}
    </span>
  );
}
