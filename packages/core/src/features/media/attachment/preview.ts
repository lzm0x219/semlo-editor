import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { safeAttachmentURL } from "../shared/attachment-url";
import type { AttachmentViews } from "./runtime";

export interface AttachmentInfo {
  href: string;
  name: string;
  /** 文件字节数；旧内容没有该值时为 0。 */
  size: number;
  mimeType: string;
}

/** 同步返回宿主阅读页地址；空值表示当前文件不可预览，不回退到原文件。 */
export type AttachmentPreviewResolver = (attachment: AttachmentInfo) => string | null | undefined;

export interface AttachmentOptions {
  getPreviewResolver(): AttachmentPreviewResolver | null | undefined;
  /** 绑定对象在替换集成时更换，识别同一回调先移除又恢复的同步重入。 */
  getPreviewOwner(): unknown;
  views?: AttachmentViews;
  onError(error: unknown): void;
}

export type AttachmentPreviewAttempt =
  | { status: "ready"; url: string }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export function attachmentInfo(node: ProseMirrorNode): AttachmentInfo | null {
  const href = safeAttachmentURL(node.attrs.href);
  if (!href) return null;
  return {
    href,
    name: typeof node.attrs.name === "string" ? node.attrs.name : "",
    size: typeof node.attrs.size === "number" && Number.isFinite(node.attrs.size) ? node.attrs.size : 0,
    mimeType: typeof node.attrs.mimeType === "string" ? node.attrs.mimeType : "",
  };
}
