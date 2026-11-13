import { DataRequestError } from "../refresh/errors";
export class LocalAiError extends DataRequestError {
  constructor(message: string, code = "local_service_unavailable", status = 0) {
    super(message, code, status);
    this.name = "LocalAiError";
  }
}

/** 连接中断、超时及无效响应不能证明请求未被接收；明确查无记录后才允许重试。 */
export function submissionIsUncertain(
  failure: unknown,
  lookupFailure?: unknown,
) {
  if (
    lookupFailure instanceof LocalAiError &&
    lookupFailure.code === "http_404"
  )
    return false;
  return (
    !(failure instanceof LocalAiError) ||
    [
      "local_service_unavailable",
      "request_timeout",
      "contract_invalid",
      "turn_mismatch",
    ].includes(failure.code) ||
    /^http_5\d\d$/.test(failure.code)
  );
}
