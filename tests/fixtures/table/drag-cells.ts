import type { Locator } from "playwright";

export async function dragCells(from: Locator, to: Locator): Promise<void> {
  // 通过可操作的单元格定位实际命中点，避免滚动或重排后坐标落到边缘控件上。
  const { mouse } = from.page();
  await from.hover();
  await mouse.down();
  try {
    await to.hover();
  } finally {
    await mouse.up();
  }
}
