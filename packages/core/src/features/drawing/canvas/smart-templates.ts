import type { CanvasGroup, CanvasPoint, CanvasShape } from "./model";

export type SmartTemplate = "smartPyramid" | "smartSegmentedPyramid" | "smartStages" | "smartArchitecture";
export const smartTemplateNames: readonly SmartTemplate[] = [
  "smartPyramid",
  "smartSegmentedPyramid",
  "smartStages",
  "smartArchitecture",
];
export const isSmartTemplate = (value: string): value is SmartTemplate =>
  smartTemplateNames.includes(value as SmartTemplate);

/** 组合只保存现有形状与 groups，不引入不可编辑的模板载荷。 */
export function createSmartTemplate(
  type: SmartTemplate,
  point: CanvasPoint,
  newId: () => string,
): { shapes: CanvasShape[]; group: CanvasGroup } {
  const shapes: CanvasShape[] = [];
  const left = point.x,
    top = point.y;
  const add = (
    shape: CanvasShape["shape"],
    x: number,
    y: number,
    width: number,
    height: number,
    text = "",
    rotation?: number,
  ) => {
    shapes.push({
      id: newId(),
      shape,
      x: left + x,
      y: top + y,
      width,
      height,
      text,
      ...(rotation === undefined ? {} : { rotation }),
    });
  };
  const text = (value: string, x: number, y: number, width: number, height = 40) =>
    add("text", x, y, width, height, value);
  if (type === "smartPyramid") {
    add("triangle", 150, 0, 150, 150);
    add("smartPyramidMiddle", 75, 150, 300, 150);
    add("smartPyramidBase", 0, 300, 450, 150);
    text("第一层", 150, 80, 150);
    text("第二层", 75, 205, 300);
    text("第三层", 0, 355, 450);
  } else if (type === "smartSegmentedPyramid") {
    add("triangle", 112.5, 0, 225, 225);
    add("triangle", 0, 225, 225, 225);
    add("triangle", 112.5, 225, 225, 225, "", 180);
    add("triangle", 225, 225, 225, 225);
    text("观点一", 162.5, 130, 125);
    text("观点二", 50, 355, 125);
    text("观点三", 162.5, 280, 125);
    text("观点四", 275, 355, 125);
  } else if (type === "smartStages") {
    add("smartStageFirst", 0, 0, 150, 50);
    add("smartChevron", 125, 0, 175, 50);
    add("smartChevron", 275, 0, 175, 50);
    text("阶段一", 10, 5, 115);
    text("阶段二", 150, 5, 125);
    text("阶段三", 300, 5, 125);
  } else {
    add("rectangle", 0, 0, 450, 450);
    add("roundedRect", 10, 10, 210, 135);
    add("roundedRect", 230, 10, 210, 135);
    add("roundedRect", 10, 157.5, 430, 135);
    add("roundedRect", 10, 305, 210, 135);
    add("roundedRect", 230, 305, 210, 135);
    text("模块1.1", 10, 57.5, 210);
    text("模块1.2", 230, 57.5, 210);
    text("模块2", 10, 205, 430);
    text("模块3.1", 10, 352.5, 210);
    text("模块3.2", 230, 352.5, 210);
  }
  return { shapes, group: { id: newId(), members: shapes.map((shape) => shape.id) } };
}
