import type { TextChild, ImageChild } from "@/store/useEditorStore";

type FabricObjectLike = {
  checkfuId?: string;
  checkfuType?: "text" | "image";
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  visible?: boolean;
  selectable?: boolean;
  // text-specific
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  // image-specific
  checkfuSrc?: string;
  checkfuPlaceholder?: boolean;
  // common fabric methods (narrowed)
  set?: (props: Record<string, unknown>) => void;
  initDimensions?: () => void;
};

export function normalizeTextScaling(obj: FabricObjectLike) {
  if (obj?.checkfuType !== "text") return;
  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  if (sx !== 1 || sy !== 1) {
    const base = obj.fontSize || 24;
    const nextFont = Math.max(6, Math.round(base * Math.max(sx, sy)));
    obj.set?.({ fontSize: nextFont, scaleX: 1, scaleY: 1 });
    obj.initDimensions?.();
  }
}

export function fabricToChild(obj: FabricObjectLike): TextChild | ImageChild {
  const round = (n: number | undefined) => Math.max(0, Math.round(n ?? 0));
  const base = {
    id: obj.checkfuId as string,
    type: obj.checkfuType as "text" | "image",
    x: round(obj.left),
    y: round(obj.top),
    width: round((obj.width || 1) * (obj.scaleX || 1)),
    height: round((obj.height || 1) * (obj.scaleY || 1)),
    angle: round(obj.angle || 0),
    visible: !!obj.visible,
    locked: !obj.selectable,
    z: 0,
  };

  if (obj.checkfuType === "text") {
    const a = obj.textAlign;
    const alignNorm: "left" | "center" | "right" =
      a === "center" || a === "right" ? a : "left";
    return {
      ...base,
      text: obj.text || "",
      fontFamily: obj.fontFamily || "Inter",
      fontSize: obj.fontSize || 24,
      fontWeight: obj.fontWeight || "normal",
      italic: obj.fontStyle === "italic",
      align: alignNorm,
    } as TextChild;
  } else {
    return {
      ...base,
      src: (obj.checkfuSrc as string) ?? undefined,
      placeholder: !!obj.checkfuPlaceholder,
      crop: null,
    } as ImageChild;
  }
}

const within = (a = 0, b = 0, eps = 0.5) => Math.abs(a - b) <= eps;

export function childrenEqual(
  a: (TextChild | ImageChild)[],
  b: (TextChild | ImageChild)[],
) {
  if (a.length !== b.length) return false;
  const map = new Map<string, TextChild | ImageChild>(b.map((c) => [c.id, c]));
  for (const x of a) {
    const y = map.get(x.id);
    if (!y || x.type !== y.type) return false;
    if (!within(x.x, y.x) || !within(x.y, y.y)) return false;
    if (!within(x.angle || 0, y.angle || 0)) return false;
    if (!!x.visible !== !!y.visible) return false;
    if (!!x.locked !== !!y.locked) return false;
    if (x.type === "text") {
      const xt = x as TextChild;
      const yt = y as TextChild;
      if (
        xt.text !== yt.text ||
        xt.fontFamily !== yt.fontFamily ||
        xt.fontSize !== yt.fontSize ||
        xt.fontWeight !== yt.fontWeight ||
        !!xt.italic !== !!yt.italic ||
        (xt.align || "left") !== (yt.align || "left")
      )
        return false;
      // Ignore width/height for text nodes
    } else {
      if ((x as ImageChild).src !== (y as ImageChild).src) return false;
      if (!within(x.width, y.width, 1) || !within(x.height, y.height, 1))
        return false;
    }
  }
  return true;
}
