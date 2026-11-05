/** Run every teardown step, then rethrow failures without losing their identity. */
export function runCleanupSteps(steps: readonly (() => void)[], message: string): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  // 单个异常保留原对象；多个异常聚合，避免后续清理失败被掩盖。
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message, { cause: errors[0] });
}
