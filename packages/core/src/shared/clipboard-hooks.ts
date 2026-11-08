const sequenceCopyHooks = new WeakSet<object>();

/** 标记内置编号列表的复制钩子，供其他内置功能判断是否存在宿主钩子。 */
export function markSequenceCopyHook(hook: object): void {
  sequenceCopyHooks.add(hook);
}

export function isSequenceCopyHook(hook: object): boolean {
  return sequenceCopyHooks.has(hook);
}
