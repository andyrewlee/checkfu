export const DPI = 96 as const;
export type Orientation = "portrait" | "landscape";

export function letterSize(o: Orientation) {
  return o === "portrait" ? { w: 8.5, h: 11 } : { w: 11, h: 8.5 };
}

export function pagePx(o: Orientation) {
  const { w, h } = letterSize(o);
  return {
    pxW: Math.max(1, Math.round(w * DPI)),
    pxH: Math.max(1, Math.round(h * DPI)),
  };
}
