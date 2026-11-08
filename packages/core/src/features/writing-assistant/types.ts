import type { JSONContent, Range } from "@tiptap/core";

export interface WritingRequest {
  prompt: string;
  context: {
    selection: { from: number; to: number; text: string; content: JSONContent[] };
    /** 选区前后各最多 1000 个文档位置，不自动发送整篇文档。 */
    before: string;
    after: string;
  };
  signal: AbortSignal;
  /** 显式追问时提供上一份草稿的独立副本；重新生成沿用上次请求，不把最新草稿自动附入。 */
  previousDraft?: WritingResult;
}

export type WritingResult = ({ format: "text"; text: string } | { format: "json"; content: JSONContent }) & {
  /** 宿主可提供服务端结果标识，用于关联用户反馈；不写入正文。 */
  feedbackId?: string;
};

export type WritingFeedbackRating = "positive" | "negative";
export interface WritingFeedbackRequest {
  rating: WritingFeedbackRating;
  prompt: string;
  result: WritingResult;
  signal: AbortSignal;
}
/** 用户点击反馈时才调用，由宿主决定如何提交。 */
export type WritingFeedbackService = (request: WritingFeedbackRequest) => void | Promise<void>;

/** 模型、认证、额度和用户协议由宿主处理；编辑器不会自动请求外部服务。 */
export type WritingService = (request: WritingRequest) => Promise<WritingResult>;

export type WritingStatus = "closed" | "prompt" | "pending" | "ready" | "error" | "stopped" | "stale";
export interface WritingSnapshot {
  status: WritingStatus;
  available: boolean;
  prompt: string;
  /** 可复制的纯文本投影；结构化结果保留在 result 中。 */
  text: string;
  result: WritingResult | null;
  message: string;
  replacing: boolean;
  canAccept: boolean;
}
export interface WritingOpenOptions {
  prompt?: string;
  /** 不传时使用打开时的选区。非空范围只会在明确接纳时替换。 */
  range?: Range;
}
export type WritingAcceptResult = "applied" | "rejected" | "unavailable" | "busy";
export type WritingAcceptMode = "default" | "after";
export interface WritingAssistantController {
  getSnapshot(): WritingSnapshot;
  subscribe(listener: () => void): () => void;
  open(options?: WritingOpenOptions): boolean;
  send(prompt: string): Promise<void>;
  followUp(prompt: string): Promise<void>;
  retry(): Promise<void>;
  stop(): void;
  accept(mode?: WritingAcceptMode): WritingAcceptResult;
  cancel(): void;
}
