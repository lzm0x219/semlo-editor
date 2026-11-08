/** 图形轮廓以 100×100 为局部坐标，编辑器、菜单和静态输出共用。 */
interface ShapePath {
  d: string;
  fill?: "body" | "stroke";
  dashed?: boolean;
}
interface ShapeGraphic {
  boundary: string;
  paths: readonly ShapePath[];
  ellipse?: boolean;
  size?: readonly [number, number];
  defaultFill?: string;
}
const rectangle = "0,0 100,0 100,100 0,100";
const rect = "M0 0H100V100H0Z";
const oval = "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z";
const ovalBoundary = Array.from({ length: 32 }, (_, index) => {
  const angle = (index * Math.PI) / 16;
  return `${50 + 50 * Math.cos(angle)},${50 + 50 * Math.sin(angle)}`;
}).join(" ");
const body = (d: string): ShapePath => ({ d, fill: "body" });
const line = (d: string): ShapePath => ({ d });
const circle = (paths: readonly ShapePath[] = [body(oval)]): ShapeGraphic => ({
  boundary: ovalBoundary,
  paths,
  ellipse: true,
  size: [80, 80],
});

export const libraryShapes = {
  circle: circle(),
  predefinedProcess: { boundary: rectangle, paths: [body(rect), line("M15 0V100M85 0V100")] },
  document: {
    boundary: "0,0 100,0 100,85 80,78 60,80 40,94 20,98 0,90",
    paths: [body("M0 0H100V85C65 55 35 115 0 90Z")],
  },
  multiDocument: {
    boundary: rectangle,
    paths: [
      body("M16 0H100V74C72 54 44 94 16 74Z"),
      body("M8 8H92V82C64 62 36 102 8 82Z"),
      body("M0 16H84V90C56 70 28 110 0 90Z"),
    ],
  },
  manualInput: { boundary: "0,25 100,0 100,100 0,100", paths: [body("M0 25L100 0V100H0Z")] },
  preparation: { boundary: "20,0 80,0 100,50 80,100 20,100 0,50", paths: [body("M20 0H80L100 50L80 100H20L0 50Z")] },
  database: {
    boundary: "0,15 15,3 50,0 85,3 100,15 100,85 85,97 50,100 15,97 0,85",
    paths: [body("M0 15C0-5 100-5 100 15V85C100 105 0 105 0 85Z"), line("M0 15C0 35 100 35 100 15")],
  },
  hardDisk: {
    boundary: "15,0 85,0 97,15 100,50 97,85 85,100 15,100 3,85 0,50 3,15",
    paths: [body("M15 0H85C105 0 105 100 85 100H15C-5 100-5 0 15 0Z"), line("M85 0C65 0 65 100 85 100")],
  },
  internalStorage: { boundary: rectangle, paths: [body(rect), line("M18 0V100M0 20H100")] },
  paperTape: {
    boundary: "0,15 25,25 75,5 100,15 100,85 75,75 25,95 0,85",
    paths: [body("M0 15C35 45 65-15 100 15V85C65 55 35 115 0 85Z")],
  },
  manualLoop: { boundary: "0,0 100,0 80,100 20,100", paths: [body("M0 0H100L80 100H20Z")] },
  delay: {
    boundary: "0,0 50,0 85,15 100,50 85,85 50,100 0,100",
    paths: [body("M0 0H50C117 0 117 100 50 100H0Z")],
  },
  storedData: {
    boundary: "15,0 100,0 88,25 85,50 88,75 100,100 15,100 3,75 0,50 3,25",
    paths: [body("M15 0H100C80 15 80 85 100 100H15C-5 100-5 0 15 0Z")],
  },
  merge: { boundary: "0,0 100,0 50,100", paths: [body("M0 0H100L50 100Z")] },
  or: circle([body(oval), line("M0 50H100M50 0V100")]),
  summingJunction: circle([body(oval), line("M15 15L85 85M85 15L15 85")]),
  display: {
    boundary: "20,0 75,0 95,15 100,50 95,85 75,100 20,100 0,50",
    paths: [body("M20 0H75C108 0 108 100 75 100H20L0 50Z")],
  },
  offPageConnector: { boundary: "0,0 100,0 100,65 50,100 0,65", paths: [body("M0 0H100V65L50 100L0 65Z")] },
  loopLimit: { boundary: "20,0 80,0 100,25 100,100 0,100 0,25", paths: [body("M20 0H80L100 25V100H0V25Z")] },
  card: { boundary: "20,0 100,0 100,100 0,100 0,25", paths: [body("M20 0H100V100H0V25Z")] },
  sort: { boundary: "50,0 100,50 50,100 0,50", paths: [body("M50 0L100 50L50 100L0 50Z"), line("M0 50H100")] },
  collate: { boundary: "0,0 100,0 50,50 100,100 0,100 50,50", paths: [body("M0 0H100L0 100H100Z")] },
  parallelMode: { boundary: rectangle, paths: [line("M0 25H100M0 75H100")] },
  annotation: { boundary: rectangle, paths: [line("M25 0H0V100H25M40 25H100M40 50H100M40 75H100")] },
  umlPackage: {
    boundary: "0,0 40,0 40,20 100,20 100,100 0,100",
    paths: [body("M0 0H40V20H100V100H0Z"), line("M0 20H40")],
  },
  umlFragment: { boundary: rectangle, paths: [body(rect), line("M0 20H35L45 10V0")] },
  umlConstraint: {
    boundary: rectangle,
    paths: [
      line(
        "M25 0Q10 0 15 30Q20 50 0 50Q20 50 15 70Q10 100 25 100M75 0Q90 0 85 30Q80 50 100 50Q80 50 85 70Q90 100 75 100",
      ),
    ],
  },
  umlNote: { boundary: "0,0 75,0 100,25 100,100 0,100", paths: [body("M0 0H75L100 25V100H0Z"), line("M75 0V25H100")] },
  umlClass: { boundary: rectangle, paths: [body(rect), line("M0 30H100M0 65H100")] },
  umlActiveClass: { boundary: rectangle, paths: [body(rect), line("M15 0V100M85 0V100")] },
  umlInterface: { boundary: rectangle, paths: [body(rect), line("M0 40H100")] },
  umlMultiObject: {
    boundary: rectangle,
    paths: [body("M16 0H100V84H16Z"), body("M8 8H92V92H8Z"), body("M0 16H84V100H0Z")],
  },
  umlTimeSignal: { boundary: "0,0 100,0 0,100 100,100", paths: [body("M0 0H100L0 100H100Z")] },
  umlActivation: { boundary: rectangle, paths: [body(rect)], size: [20, 120] },
  umlEntity: circle([body("M50 0A40 40 0 1 1 50 80A40 40 0 1 1 50 0Z"), line("M10 95H90")]),
  umlControl: circle([body("M50 15A42 42 0 1 1 49.9 15Z"), line("M50 0L35 15H65")]),
  umlBoundary: {
    boundary: rectangle,
    paths: [body("M65 15A35 35 0 1 1 65 85A35 35 0 1 1 65 15Z"), line("M0 0V100M0 50H30")],
  },
  umlDestroy: { boundary: rectangle, paths: [line("M0 0L100 100M100 0L0 100")], size: [40, 40] },
  umlStart: { ...circle([body(oval)]), defaultFill: "#555555" },
  umlEnd: circle([body(oval), { d: "M50 15A35 35 0 1 1 50 85A35 35 0 1 1 50 15Z", fill: "stroke" }]),
  umlFlowFinal: circle([body(oval), line("M15 15L85 85M85 15L15 85")]),
  umlHistory: circle([body(oval), line("M32 25V75M68 25V75M32 50H68")]),
  umlSendSignal: { boundary: "0,0 75,0 100,50 75,100 0,100", paths: [body("M0 0H75L100 50L75 100H0Z")] },
  umlReceiveSignal: { boundary: "0,0 100,0 100,100 0,100 25,50", paths: [body("M0 0H100V100H0L25 50Z")] },
  umlSynchronization: { boundary: rectangle, paths: [body(rect)], size: [120, 10], defaultFill: "#555555" },
  umlComponent: {
    boundary: rectangle,
    paths: [body("M20 0H100V100H20Z"), body("M0 20H35V40H0Z"), body("M0 60H35V80H0Z")],
  },
  umlNode: {
    boundary: "20,0 100,0 100,80 80,100 0,100 0,20",
    paths: [body("M20 0H100V80L80 100H0V20Z"), line("M0 20H80V100M80 20L100 0")],
  },
  erWeakEntity: { boundary: rectangle, paths: [body(rect), line("M8 10H92V90H8Z")] },
  erDerivedAttribute: { ...circle([{ d: oval, fill: "body", dashed: true }]), size: [120, 60] },
  erMultiAttribute: { ...circle([body(oval), line("M50 10A40 40 0 1 1 50 90A40 40 0 1 1 50 10Z")]), size: [120, 60] },
  erWeakRelationship: {
    boundary: "50,0 100,50 50,100 0,50",
    paths: [body("M50 0L100 50L50 100L0 50Z"), line("M50 12L88 50L50 88L12 50Z")],
  },
  erGeneralization: {
    boundary: "50,0 100,25 50,100 0,25",
    paths: [body("M0 25H100L50 100Z"), line("M50 0V25")],
    size: [80, 80],
  },
  erTotalGeneralization: {
    boundary: "50,0 100,25 50,100 0,25",
    paths: [body("M0 25H100L50 100Z"), line("M40 0V25M60 0V25")],
    size: [80, 80],
  },
  smartPyramidMiddle: { boundary: "25,0 75,0 100,100 0,100", paths: [body("M25 0H75L100 100H0Z")] },
  smartPyramidBase: {
    boundary: "16.666667,0 83.333333,0 100,100 0,100",
    paths: [body("M16.666667 0H83.333333L100 100H0Z")],
  },
  smartChevron: {
    boundary: "0,0 85.714286,0 100,50 85.714286,100 0,100 14.285714,50",
    paths: [body("M0 0H85.714286L100 50L85.714286 100H0L14.285714 50Z")],
  },
  smartStageFirst: {
    boundary: "0,0 83.333333,0 100,50 83.333333,100 0,100",
    paths: [body("M0 0H83.333333L100 50L83.333333 100H0Z")],
  },
} as const satisfies Record<string, ShapeGraphic>;

export type LibraryShape = keyof typeof libraryShapes;
export const libraryShapeNames = Object.keys(libraryShapes) as LibraryShape[];
export function shapeGraphic(shape: string): ShapeGraphic | undefined {
  return Object.hasOwn(libraryShapes, shape) ? libraryShapes[shape as LibraryShape] : undefined;
}
interface GraphicStyle {
  fill: string;
  stroke: string;
  width: number;
  dashed?: boolean;
}
/** 所有 d 都来自内部图形定义，颜色和宽度由既有画布校验后传入。 */
export function graphicPaths(shape: string, style: GraphicStyle): Array<Record<string, string | number>> {
  return (shapeGraphic(shape)?.paths ?? []).map((part) => ({
    d: part.d,
    fill: part.fill === "stroke" ? style.stroke : part.fill === "body" ? style.fill : "none",
    stroke: style.stroke,
    "stroke-width": style.width,
    "stroke-linejoin": "round",
    "vector-effect": "non-scaling-stroke",
    ...(style.dashed || part.dashed ? { "stroke-dasharray": "5 4" } : {}),
  }));
}
