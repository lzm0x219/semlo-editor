export const mindmapNodePrefix = "@mindmap-node:";
export const mindmapPendingNodePrefix = "@mindmap-path:";

export const mindmapNodeReference = (id: string) => `${mindmapNodePrefix}${id}`;
export const mindmapPendingNodeReference = (path: number[]) => `${mindmapPendingNodePrefix}${JSON.stringify(path)}`;
