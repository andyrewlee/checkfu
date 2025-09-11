import { pagePx } from "@/lib/image/pageMetrics";
import type { Page } from "@/store/useEditorStore";

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("load failed"));
    img.src = src;
  });
  return img;
}

export async function blobUrlToPngBase64(url: string): Promise<string> {
  const img = await loadImage(url);
  const max = 1650; // ~150dpi letter bound
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = c.toDataURL("image/png");
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

export async function fitImageToPrintableArea(
  url: string,
  p: Page,
): Promise<string> {
  const { pxW, pxH } = pagePx(p.orientation);
  const img = await loadImage(url);

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return url;
  srcCtx.drawImage(img, 0, 0);
  const data = srcCtx.getImageData(0, 0, img.width, img.height).data;

  const isWhite = (idx: number) => {
    const r = data[idx],
      g = data[idx + 1],
      b = data[idx + 2],
      a = data[idx + 3];
    if (a < 8) return true;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 250;
  };

  let top = 0,
    bottom = img.height - 1,
    left = 0,
    right = img.width - 1;
  // scan each side for first non-white pixel
  scanTop: for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        top = Math.max(0, y - 1);
        break scanTop;
      }
    }
  }
  scanBottom: for (let y = img.height - 1; y >= 0; y--) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        bottom = Math.min(img.height - 1, y + 1);
        break scanBottom;
      }
    }
  }
  scanLeft: for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        left = Math.max(0, x - 1);
        break scanLeft;
      }
    }
  }
  scanRight: for (let x = img.width - 1; x >= 0; x--) {
    for (let y = 0; y < img.height; y += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        right = Math.min(img.width - 1, x + 1);
        break scanRight;
      }
    }
  }

  let sx = Math.max(0, left),
    sy = Math.max(0, top);
  let sw = Math.max(1, right - left + 1),
    sh = Math.max(1, bottom - top + 1);

  const bleed = 0;
  if (sw < img.width || sh < img.height) {
    sx = Math.min(Math.max(0, sx + bleed), img.width - 1);
    sy = Math.min(Math.max(0, sy + bleed), img.height - 1);
    sw = Math.max(1, Math.min(img.width - sx, sw - bleed * 2));
    sh = Math.max(1, Math.min(img.height - sy, sh - bleed * 2));
  }

  const c = document.createElement("canvas");
  c.width = pxW;
  c.height = pxH;
  const ctx = c.getContext("2d");
  if (!ctx) return url;
  ctx.imageSmoothingQuality = "high";

  const availW = pxW;
  const availH = pxH;
  const scale = Math.min(availW / Math.max(1, sw), availH / Math.max(1, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((availW - dw) / 2);
  const dy = Math.floor((availH - dh) / 2);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  return c.toDataURL("image/png");
}

// Trim white borders and fit an image into a target rectangle (node) while preserving aspect.
export async function fitImageToRect(
  url: string,
  targetW: number,
  targetH: number,
): Promise<string> {
  const img = await loadImage(url);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const sctx = srcCanvas.getContext("2d");
  if (!sctx) return url;
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, img.width, img.height).data;
  const isWhite = (i: number) => {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3];
    if (a < 8) return true;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 250; // treat near-white as background
  };
  let top = 0,
    bottom = img.height - 1,
    left = 0,
    right = img.width - 1;
  // scan top
  scanTop: for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        top = Math.max(0, y - 1);
        break scanTop;
      }
    }
  }
  // scan bottom
  scanBottom: for (let y = img.height - 1; y >= 0; y--) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        bottom = Math.min(img.height - 1, y + 1);
        break scanBottom;
      }
    }
  }
  // scan left
  scanLeft: for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        left = Math.max(0, x - 1);
        break scanLeft;
      }
    }
  }
  // scan right
  scanRight: for (let x = img.width - 1; x >= 0; x--) {
    for (let y = 0; y < img.height; y += 2) {
      const i = (y * img.width + x) * 4;
      if (!isWhite(i)) {
        right = Math.min(img.width - 1, x + 1);
        break scanRight;
      }
    }
  }
  let sx = Math.max(0, left),
    sy = Math.max(0, top);
  let sw = Math.max(1, right - left + 1),
    sh = Math.max(1, bottom - top + 1);
  // guard: if nearly full white detection failed, just use full image
  if (sw < 8 || sh < 8) {
    sx = 0;
    sy = 0;
    sw = img.width;
    sh = img.height;
  }

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(targetW));
  c.height = Math.max(1, Math.round(targetH));
  const ctx = c.getContext("2d");
  if (!ctx) return url;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  const scale = Math.min(c.width / sw, c.height / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((c.width - dw) / 2);
  const dy = Math.floor((c.height - dh) / 2);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  return c.toDataURL("image/png");
}

export async function thresholdToDataUrl(
  srcUrl: string,
  threshold: number,
): Promise<string> {
  const img = await loadImage(srcUrl);
  const maxW = 1024;
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const v = y >= threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
