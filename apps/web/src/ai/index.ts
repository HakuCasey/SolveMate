import type { Message, ReadingSelection, Robot } from "@solvemate/contracts";

export interface AiRequest {
  selection: ReadingSelection | null;
  robot: Robot;
  messages: Message[];
  signal?: AbortSignal;
}

export interface AiConnection {
  available: boolean;
  send(request: AiRequest): AsyncIterable<string>;
}

export class AiNotConnectedError extends Error {
  constructor() {
    super("AI service is not connected.");
    this.name = "AiNotConnectedError";
  }
}

/** 首版仅保留连接接口；未接入时不能把固定示例当作生成结果。 */
export const unavailableAiConnection: AiConnection = {
  available: false,
  send() {
    return {
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(new AiNotConnectedError()) };
      },
    };
  },
};
