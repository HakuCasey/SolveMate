export class LocalAiError extends Error {
  constructor(
    message: string,
    readonly code = "local_service_unavailable",
  ) {
    super(message);
    this.name = "LocalAiError";
  }
}
