import type { IText, Image, Group } from "fabric";

export async function createImageFromURL(url: string): Promise<Image> {
  const { Image } = await import("fabric");
  return Image.fromURL(url, { crossOrigin: "anonymous" });
}

export async function createTextObject(opts: {
  left: number;
  top: number;
  fontFamily?: string;
  fontSize?: number;
  text?: string;
  fill?: string;
}): Promise<IText> {
  const { IText } = await import("fabric");
  const t: IText = new IText(opts.text ?? "New text", {
    left: opts.left,
    top: opts.top,
    fontFamily: opts.fontFamily ?? "Inter",
    fontSize: opts.fontSize ?? 24,
    fill: opts.fill ?? "#000",
  });
  t.set({ scaleX: 1, scaleY: 1 });
  return t;
}

export async function createImagePlaceholder(
  left: number,
  top: number,
  w = 200,
  h = 150,
): Promise<Group> {
  const { Rect, Line, Group } = await import("fabric");
  const rect = new Rect({
    left: 0,
    top: 0,
    width: w,
    height: h,
    fill: "",
    stroke: "#94a3b8",
    strokeDashArray: [4, 3],
  });
  const l1 = new Line([0, 0, w, h], { stroke: "#cbd5e1" });
  const l2 = new Line([0, h, w, 0], { stroke: "#cbd5e1" });
  return new Group([rect, l1, l2], { left, top });
}
