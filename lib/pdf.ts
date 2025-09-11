import { pagePx, letterSize } from "@/lib/image/pageMetrics";
import type { Page, TextChild, ImageChild } from "@/store/useEditorStore";
import type { jsPDF } from "jspdf";

export async function flattenPageToPng(page: Page): Promise<string | null> {
  if (page.children && page.children.length) {
    const { StaticCanvas, IText, Image } = await import("fabric");
    const { pxW, pxH } = pagePx(page.orientation);
    const canvas = new StaticCanvas(undefined, {
      width: pxW,
      height: pxH,
      backgroundColor: "#fff",
    });
    for (const c of page.children) {
      if (c.visible === false) continue;
      if (c.type === "text") {
        const tc = c as TextChild;
        const t = new IText(tc.text || "", {
          left: tc.x,
          top: tc.y,
          fontFamily: tc.fontFamily || "Inter",
          fontSize: tc.fontSize || 24,
          fontWeight: tc.fontWeight || "normal",
          fontStyle: tc.italic ? "italic" : "",
          textAlign: tc.align || "left",
          fill: "#000",
        });
        t.set({ angle: c.angle || 0 });
        if (t.width && t.height) {
          t.set({
            scaleX: c.width / t.width,
            scaleY: c.height / t.height,
          });
        }
        canvas.add(t);
      } else {
        const ic = c as ImageChild;
        if (!ic.src) continue; // skip placeholders
        const img = await Image.fromURL(ic.src, { crossOrigin: "anonymous" });
        img.set({ left: ic.x, top: ic.y, angle: ic.angle || 0 });
        if (img.width && img.height) {
          img.set({
            scaleX: ic.width / img.width,
            scaleY: ic.height / img.height,
          });
        }
        canvas.add(img);
      }
    }
    canvas.renderAll();
    return canvas.toDataURL({ format: "png", multiplier: 2 });
  }
  if (page.imageUrl) return page.imageUrl;
  return null;
}

export async function addPageToJsPdf(pdf: jsPDF, page: Page) {
  const { w: pageW, h: pageH } = letterSize(page.orientation);
  const m = 0;
  const imgW = pageW;
  const imgH = pageH;
  const png = await flattenPageToPng(page);
  if (!png) return;
  pdf.addImage(png, "PNG", m, m, imgW, imgH, undefined, "FAST");
  const codes = (page.standards || []).join(", ");
  if (codes) {
    pdf.setFontSize(8);
    pdf.text(`Standards: ${codes}`, m, pageH - 0.3);
  }
}
