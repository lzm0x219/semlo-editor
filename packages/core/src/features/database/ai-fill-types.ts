import type { DatabaseAiConfig, DatabaseFieldType, DatabaseValue } from "./model";

/** 宿主自行处理模型、权限与额度；调用发生在用户明确启动填写时。 */
export interface DatabaseAiFillRequest {
  databaseId: string;
  field: { id: string; name: string; rule: DatabaseAiConfig };
  fields: Array<{
    id: string;
    name: string;
    type: DatabaseFieldType;
    options: Array<{ id: string; label: string; externalId?: string }>;
  }>;
  records: Array<{ id: string; values: Record<string, DatabaseValue> }>;
  signal: AbortSignal;
}
export interface DatabaseAiFillResult {
  recordId: string;
  value: string;
}
export type DatabaseAiFillService = (request: DatabaseAiFillRequest) => Promise<DatabaseAiFillResult[]>;
