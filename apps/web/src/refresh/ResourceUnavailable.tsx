import { dataRefresh } from "./coordinator";
/** 当前资料不可读时保留页面与输入，只重新读取业务数据。 */
export function ResourceUnavailable({
  message,
  onBack,
}: {
  message: string;
  onBack?: () => void;
}) {
  return (
    <section role="alert" style={{ padding: 24, lineHeight: 1.8 }}>
      <h2>暂时无法打开内容</h2>
      <p>{message}</p>
      <button onClick={() => void dataRefresh.refresh()}>刷新数据</button>
      {onBack && <button onClick={onBack}>返回列表</button>}
    </section>
  );
}
