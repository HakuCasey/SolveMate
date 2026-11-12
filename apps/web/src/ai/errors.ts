import { DataRequestError } from "../refresh/errors";
export class LocalAiError extends DataRequestError {
  constructor(message: string, code = "local_service_unavailable", status = 0) {
    super(message, code, status);
    this.name = "LocalAiError";
  }
}
