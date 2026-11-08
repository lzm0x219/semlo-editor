import type { AttachmentUpload, ImageUpload, MentionSearch } from "../../types";
import type { DatabaseAiFillService } from "./ai-fill-types";
import { DatabaseContentError, normalizeDatabaseActor, type DatabaseActor } from "./model";

export interface DatabaseOptions {
  getUploadImage: () => ImageUpload | undefined;
  getUploadAttachment: () => AttachmentUpload | undefined;
  getSearchMentions: () => MentionSearch | undefined;
  getCurrentUser: () => (() => DatabaseActor | null) | undefined;
  getAiFill: () => DatabaseAiFillService | null | undefined;
  onError: (error: unknown) => void;
}

class DatabaseActorReadError extends DatabaseContentError {
  constructor(cause: unknown) {
    super("读取当前用户失败");
    this.cause = cause;
  }
}

export function reportDatabaseError(options: DatabaseOptions | undefined, error: DatabaseContentError): void {
  options?.onError(error instanceof DatabaseActorReadError ? error.cause : error);
}

export function readDatabaseActor(options?: DatabaseOptions): DatabaseActor | null {
  let value: unknown;
  try {
    const getCurrentUser = options?.getCurrentUser();
    if (!getCurrentUser) return null;
    value = getCurrentUser();
  } catch (error) {
    throw new DatabaseActorReadError(error);
  }
  if (value === null) return null;
  const actor = normalizeDatabaseActor(value);
  if (!actor) throw new DatabaseContentError("当前用户的标识和名称不能为空");
  return actor;
}
