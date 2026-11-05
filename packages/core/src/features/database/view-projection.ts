import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface DatabaseViewProjection {
  node: ProseMirrorNode;
  viewId: string;
  groupFieldId: string;
  groups: Array<{ key: string; recordIds: string[]; collapsed: boolean }>;
}

const projections = new WeakMap<HTMLElement, DatabaseViewProjection>();
export const getDatabaseViewProjection = (element: HTMLElement) => projections.get(element);
export function setDatabaseViewProjection(element: HTMLElement, projection: DatabaseViewProjection | undefined) {
  if (projection) projections.set(element, projection);
  else projections.delete(element);
}
