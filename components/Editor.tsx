"use client";

/**
 * Editor
 * Node-based generator for printable K–1 pages
 * - Graph of Page nodes rendered via React Flow
 * - Each Page is one US Letter page with a single image (no enforced margins)
 * - Branching creates child variants from a parent image plus a prompt
 * - Inspector manages Page Type, Standards, Style, System Prompt, and Prompt
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  generateColoringBookImage,
  transformImageWithPrompt,
  generateTextContent,
} from "@/lib/nanoBanana";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import type {
  Edge,
  Node as RFNode,
  Connection,
  NodeTypes,
} from "@xyflow/react";
import { jsPDF } from "jspdf";
import PageNode, { type PageNodeData } from "@/components/nodes/PageNode";
// Layers panel removed from Inspector to focus on a single selection
import {
  useActions,
  usePages,
  useCurrentPageId,
  useCurrentPage,
  useEditorStore,
} from "@/store/useEditorStore";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Types now sourced from global editor store
import type {
  Page,
  TextChild,
  ImageChild,
  Orientation,
} from "@/store/useEditorStore";

/**
 * Module: Constants and narrow utilities
 */

const DPI = 96;
const DEFAULT_THRESHOLD = 200;

const getLetterSizeIn = (o: Orientation) =>
  o === "portrait" ? { w: 8.5, h: 11 } : { w: 11, h: 8.5 };

export const nodeTypes: NodeTypes = { page: PageNode };

// React Flow stable constants to avoid prop identity churn
const RF_FIT_VIEW_OPTIONS = { padding: 0.22 } as const;
const RF_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.72 } as const;
const RF_TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [-100000, -100000],
  [100000, 100000],
];

function revokeIfBlob(url?: string) {
  try {
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

async function createImage(src: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("load failed"));
    img.src = src;
  });
  return img;
}

/**
 * Module: Image utilities — fit, trim, threshold, base64
 */

function computePagePx(p: Page): { pxW: number; pxH: number } {
  const { w, h } = getLetterSizeIn(p.orientation);
  return {
    pxW: Math.max(1, Math.round(w * DPI)),
    pxH: Math.max(1, Math.round(h * DPI)),
  };
}

async function blobUrlToPngBase64(url: string): Promise<string> {
  const img = await createImage(url);
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

async function fitImageToPrintableArea(url: string, p: Page): Promise<string> {
  const { pxW, pxH } = computePagePx(p);
  const img = await createImage(url);

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
// No extra padding is added; any remaining gap is due to aspect mismatch.
async function fitImageToRect(
  url: string,
  targetW: number,
  targetH: number,
): Promise<string> {
  const img = await createImage(url);
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

// Ensure model output for text nodes is a single clean label (no markdown or reasoning)
function cleanSingleLineLabel(s: string): string {
  if (!s) return "";
  let t = String(s);
  // strip code fences and any markdown blocks
  t = t.replace(/```[\s\S]*?```/g, " ");
  // remove common leading words the model might emit
  t = t.replace(/^\s*(Output|Answer|Label)\s*[:\-]\s*/i, "");
  // collapse newlines to spaces
  t = t.replace(/[\r\n]+/g, " ");
  // strip surrounding quotes/backticks
  t = t.replace(/^['"`\u201C\u201D]+|['"`\u201C\u201D]+$/g, "");
  // collapse whitespace
  t = t.replace(/\s{2,}/g, " ").trim();
  // limit length to a reasonable label
  if (t.length > 140) t = t.slice(0, 140);
  return t;
}

async function thresholdToDataUrl(
  srcUrl: string,
  threshold: number,
): Promise<string> {
  const img = await createImage(srcUrl);
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

/**
 * Module: Standards loader — flatten CCSS Kindergarten structure
 */

async function loadKStandards(): Promise<
  { code: string; description: string }[]
> {
  const res = await fetch("/ccss_kindergarten_math_standards.json");
  if (!res.ok) return [];
  const data = await res.json();
  const flat: { code: string; description: string }[] = [];
  for (const d of data.domains || []) {
    for (const c of d.clusters || []) {
      for (const s of c.standards || []) {
        if (s.code && s.description)
          flat.push({ code: s.code, description: s.description });
        if (Array.isArray(s.components)) {
          for (const comp of s.components) {
            if (comp.code && comp.description)
              flat.push({ code: comp.code, description: comp.description });
          }
        }
      }
    }
  }
  return flat;
}

/**
 * Module: Prompt builder — system plus user prompt
 */

function computeSystemPrompt(
  p: Page,
  standardsCatalog: { code: string; description: string }[],
): string {
  const isWorksheet = (p.pageType || "coloring") === "worksheet";
  const { w, h } = getLetterSizeIn(p.orientation);
  const letter = `${w}×${h} ${p.orientation}`;
  const printRules = [
    `Print target: US Letter ${letter}.`,
    "Output: one black and white line art image for print.",
    "Style: thick uniform outlines, high contrast, large closed shapes. No gray tones. No shading. No halftones. No photo textures.",
    "Background: white only.",
    "Exclusions: no frames, borders, watermarks, signatures, logos, or captions.",
    "Aspect: do not change the provided orientation.",
    "If a mask is provided, change only masked regions and keep all unmasked regions identical.",
  ].join(" ");
  if (isWorksheet) {
    const selected = p.standards || [];
    const codes = selected.join(", ");
    const lookup = new Map(
      standardsCatalog.map((s) => [s.code, s.description] as const),
    );
    const descs = selected
      .map((code) => {
        const d = lookup.get(code) || "";
        return d ? `${code}: ${d}` : "";
      })
      .filter(Boolean);
    const ccSummary = codes
      ? `Common Core Kindergarten focus: ${codes}. `
      : "Common Core Kindergarten math practices. ";
    const ccDetail = descs.length
      ? `Target standards: ${descs.join("; ")}. `
      : "";
    const wk = [
      "Purpose: a solvable worksheet that a kindergarten student can complete independently.",
      "1) Provide exactly one short instruction line at the top in simple English.",
      "2) Use concrete visual math tools such as ten frames, number lines, dot cards, or simple manipulatives.",
      "3) Quantities never exceed 10. Prefer numerals for labels and examples.",
      "4) Use three to six tasks or one main task with three to six parts.",
      "5) Provide large answer areas about 1.25 inch squares or lines with generous white space.",
      "6) Layout flows left to right then top to bottom. Keep balance and clarity.",
      "7) High contrast line art suitable for printing.",
    ].join(" ");
    const wkNegatives = [
      "Do not add titles or headers.",
      "Do not add decorative frames.",
      "",
      "Do not include stickers, emojis, photographs, or gray fills.",
    ].join(" ");
    return `${ccSummary}${ccDetail}${wk} ${printRules} ${wkNegatives}`.trim();
  }
  const styleName = p.coloringStyle || "classic";
  const styleText =
    styleName === "anime"
      ? "Style: anime for children. Clean inked outlines, friendly faces, very large fill areas. No screen tones."
      : styleName === "retro"
        ? "Style: retro nineteen sixty cartoon look. Bold contour lines, simple geometry, playful characters."
        : "Style: classic coloring book. Bold outlines and large closed regions that are easy to color.";
  const col = [
    "Purpose: a kid friendly coloring page with one clear subject and readable shapes.",
    "1) Composition fills the printable area while preserving balanced white space.",
    "2) Use thick outlines and closed shapes to avoid tiny slivers.",
    "3) No text at all.",
    "4) High contrast line art that prints cleanly.",
  ].join(" ");
  const colNegatives = [
    "Do not use gray tones or shading.",
    "Do not use fine hatching or dense patterns.",
    "Do not add borders, titles, captions, watermarks, or logos.",
    "Do not place elements on or past the margins.",
  ].join(" ");
  return `${styleText} ${col} ${printRules} ${colNegatives}`.trim();
}

// Derived System Prompt: compute unless user has edited
function getEffectiveSystemPrompt(
  page: Page,
  catalog: { code: string; description: string }[],
): string {
  return page.systemPromptEdited
    ? (page.systemPrompt ?? "")
    : computeSystemPrompt(page, catalog);
}

// Summarize page children for prompts and generation context
function summarizePageForPrompt(page: Page): string {
  const items = (page.children || []).map((c) => {
    const size = `${Math.round(c.width)}x${Math.round(c.height)}`;
    const pos = `(${Math.round(c.x)}, ${Math.round(c.y)})`;
    if (c.type === "text") {
      const tc = c as TextChild;
      const text = (tc.text || "").slice(0, 80);
      return `Text "${text}" at ${pos} size ${size}${tc.align ? ` align ${tc.align}` : ""}`;
    } else {
      const ic = c as ImageChild;
      return `${ic.src ? "Image" : "Image placeholder"} at ${pos} size ${size}`;
    }
  });
  return items.join("\n");
}

/**
 * Hooks — event-safe callbacks and DOM listeners
 */
function useEvent<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  return useCallback((...args: TArgs) => ref.current(...args), []);
}

function useAutoScrollIntoView(id: string | null) {
  useEffect(() => {
    if (!id) return;
    const el = document.getElementById(`page-item-${id}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [id]);
}

function useGeminiApiKeyNeeded() {
  const [needsApiKey, setNeedsApiKey] = useState(true);
  useEffect(() => {
    const compute = () => {
      try {
        if (typeof window === "undefined") return true;
        const v = window.localStorage.getItem("CHECKFU_GEMINI_API_KEY");
        return !v;
      } catch {
        return true;
      }
    };
    setNeedsApiKey(compute());
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === "CHECKFU_GEMINI_API_KEY") {
        setNeedsApiKey(compute());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return needsApiKey;
}

function useDropAndPasteImport<T extends HTMLElement>(
  targetRef: React.RefObject<T | null>,
  onImportImage: (url: string, title?: string) => void,
  onError?: (msg: string) => void,
) {
  const importLatest = useEvent(onImportImage);
  const errorLatest = useEvent(
    onError ?? ((() => {}) as (msg: string) => void),
  );

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          importLatest(URL.createObjectURL(file), file.name);
        }
      }
      if (files.length) return;
      const urlText =
        e.dataTransfer.getData("text/uri-list") ||
        e.dataTransfer.getData("text/plain");
      if (urlText && /^https?:\/\//i.test(urlText)) {
        try {
          const resp = await fetch(urlText);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            importLatest(URL.createObjectURL(blob), "Dropped URL image");
          }
        } catch {
          errorLatest("Failed to fetch dropped URL");
        }
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      const imgItem = items.find((it) => it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (!file) return;
        importLatest(URL.createObjectURL(file), "Pasted image");
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text && /^https?:\/\//i.test(text)) {
        try {
          const resp = await fetch(text);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            importLatest(URL.createObjectURL(blob), "Pasted URL image");
          }
        } catch {
          errorLatest("Failed to fetch pasted URL");
        }
      }
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [targetRef, importLatest, errorLatest]);
}

function useKeyboardShortcuts(opts: {
  onQuickGenerate: () => void;
  onDeleteSelected: () => void;
}) {
  const onQuick = useEvent(opts.onQuickGenerate);
  const onDelete = useEvent(opts.onDeleteSelected);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const editing = !!(
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      );
      if (!editing && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onQuick();
      } else if (!editing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        onDelete();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onQuick, onDelete]);
}

/**
 * Module: PDF helpers
 */

async function flattenPageToPng(page: Page): Promise<string | null> {
  if (page.children && page.children.length) {
    const { StaticCanvas, IText, Image } = await import("fabric");
    const { pxW, pxH } = computePagePx(page);
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
        if (!ic.src) {
          // skip placeholders in flatten
          continue;
        }
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

async function addPageToJsPdf(pdf: jsPDF, page: Page) {
  const { w: pageW, h: pageH } = getLetterSizeIn(page.orientation);
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

/**
 * Module: Editor component
 */

export default function Editor() {
  const pages = usePages();
  const currentPageId = useCurrentPageId();
  const currentPage = useCurrentPage();
  const actions = useActions();
  type PageRFNode = RFNode<PageNodeData, "page">;
  const [nodes, setNodes, onNodesChange] = useNodesState<PageRFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [showSettings, setShowSettings] = useState(false);
  // Loaded CCSS Kindergarten standards catalog (code + description)
  const [standardsCatalog, setStandardsCatalog] = useState<
    { code: string; description: string }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flat = await loadKStandards();
        if (!cancelled) setStandardsCatalog(flat);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [toasts, setToasts] = useState<
    { id: string; kind: "error" | "info" | "success"; text: string }[]
  >([]);
  // Per-node quick prompts for Text/Image inspectors
  const [nodePrompts, setNodePrompts] = useState<Record<string, string>>({});
  // Per-node preset selection (None by default)
  const [nodePresets, setNodePresets] = useState<Record<string, string>>({});
  const lastQuickGenAtRef = useRef<number>(0);
  const generatingAny = pages.some((p) => p.generating);
  const needsApiKey = useGeminiApiKeyNeeded();
  // Stable handler refs to avoid dependency cycles in callbacks/effects
  const branchFromRef = useRef<(id: string) => void>(() => {});
  const branchFromWithPromptRef = useRef<
    (id: string, prompt: string) => Promise<void>
  >(async () => {});
  const generateChildFromParentRef = useRef<
    (childId: string, parent: Page, prompt: string) => Promise<void>
  >(async () => {});
  const deleteNodeRef = useRef<(id: string) => void>(() => {});
  const quickGenerateRef = useRef<(id: string) => Promise<void>>(
    async () => {},
  );
  // Keep current page visible in the sidebar
  useAutoScrollIntoView(currentPageId);

  function pushToast(
    text: string,
    kind: "error" | "info" | "success" = "info",
  ) {
    const id = crypto.randomUUID();
    setToasts((ts) => ts.concat({ id, kind, text }));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000);
  }

  // Use hook-supplied onNodesChange directly to avoid loops

  // Stable React Flow event handlers to prevent StoreUpdater loops
  const onConnectStable = useCallback(
    (c: Connection) => setEdges((es) => addEdge(c, es)),
    [setEdges],
  );
  const onNodeClickStable = useCallback(
    (_: unknown, n: { id: string }) => actions.setCurrentPage(n.id),
    [actions],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setEdges((es) =>
        es.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      );
      ids.forEach((id) => (actions as any).deletePage?.(id));
      const s = useEditorStore.getState();
      if (s.currentPageId && ids.includes(s.currentPageId)) {
        const nextId = s.order[0] ?? null;
        actions.setCurrentPage(nextId);
      }
      setNodes((ns) => ns.filter((n) => !ids.includes(n.id)));
    },
    [setEdges, setNodes, actions],
  );

  const setPagePatch = useCallback(
    (id: string, patch: Partial<Page>) => {
      actions.patchPage(id, patch);
    },
    [actions],
  );

  // Convert image to 1‑bit black/white at a given threshold
  const applyThreshold = useCallback(
    async (pageId: string, threshold: number) => {
      const page = useEditorStore.getState().pages[pageId];
      if (!page || !page.originalImageUrl) return;
      try {
        const url = await thresholdToDataUrl(page.originalImageUrl, threshold);
        revokeIfBlob(page.imageUrl); // avoid leaks from stale object URLs
        setPagePatch(pageId, { imageUrl: url, bwThreshold: threshold });
      } catch {
        /* ignore */
      }
    },
    [setPagePatch],
  );

  // System prompt is derived on read via getEffectiveSystemPrompt (no Effect)

  const addPageFromImage = useCallback(
    (url: string, title = "Image", overrides?: Partial<Page>) => {
      const id =
        (actions as any).addPageFromImage?.(url, title, overrides) ??
        crypto.randomUUID();
      // optionally apply threshold here if needed
      return id as string;
    },
    [actions],
  );

  // Branch prompt modal state
  const [branchingParentId, setBranchingParentId] = useState<string | null>(
    null,
  );
  const [branchPrompt, setBranchPrompt] = useState<string>("");

  const branchFrom = useCallback((parentId: string) => {
    const parent = useEditorStore.getState().pages[parentId];
    if (!parent) return;
    setBranchingParentId(parentId);
    setBranchPrompt(parent.prompt || "");
  }, []);
  useEffect(() => {
    branchFromRef.current = branchFrom;
  }, [branchFrom]);

  // branchFromWithPrompt is defined later (after generateInto) to avoid TS hoisting complaints

  const quickGenerate = useCallback(async (pageId: string) => {
    const page = useEditorStore.getState().pages[pageId];
    if (!page) return;
    const now = Date.now();
    if (now - lastQuickGenAtRef.current < 1200) {
      return;
    }
    lastQuickGenAtRef.current = now;
    const prompt = (page.prompt || "").trim();
    if (!prompt) {
      setBranchingParentId(pageId);
      setBranchPrompt("");
      return;
    }
    await branchFromWithPromptRef.current(pageId, prompt);
  }, []);
  useEffect(() => {
    quickGenerateRef.current = quickGenerate;
  }, [quickGenerate]);

  const buildInstruction = useCallback(
    (
      page: Page,
      userPrompt: string,
      mode: "page" | "image" | "text" = "page",
    ): string => {
      const sys = getEffectiveSystemPrompt(page, standardsCatalog).trim();
      const user = (userPrompt || "").trim();
      const parts: string[] = [];
      if (!user || !user.includes(sys)) parts.push(sys);
      if (mode === "image") {
        const isolation =
          "Treat this as a single image layer. Ignore other layers (text or images) on the page unless explicitly referenced.";
        const optionalText =
          "Include text only if the prompt requests it; otherwise prefer illustration without captions.";
        parts.push(
          user
            ? `${user}\n${isolation}\n${optionalText}`
            : `${isolation}\n${optionalText}`,
        );
      } else if (mode === "text") {
        if (user) parts.push(user);
      } else {
        const summary = summarizePageForPrompt(page);
        if (user) parts.push(user);
        if (summary) parts.push(summary);
      }
      return parts.join("\n");
    },
    [standardsCatalog],
  );

  const generateInto = useCallback(
    async (pageId: string, prompt: string, pageOverride?: Page) => {
      try {
        const page = pageOverride ?? useEditorStore.getState().pages[pageId]!;
        setPagePatch(pageId, { generating: true, status: "Generating…" });

        const instructionText = buildInstruction(page, prompt, "text");
        const instructionImage = buildInstruction(page, prompt, "image");

        // 1) Update all text children with text model
        let childrenStage = [...(page.children || [])];
        for (let i = 0; i < childrenStage.length; i++) {
          const c = childrenStage[i];
          if (c.type === "text") {
            const tc = c as TextChild;
            const textPrompt = [
              instructionText,
              "You are updating a single text label on a printable page.",
              "Return only the new text, no commentary.",
              `Current text: "${tc.text || ""}"`,
            ].join("\n");
            try {
              const out = await generateTextContent(textPrompt);
              const label = cleanSingleLineLabel(out);
              childrenStage = childrenStage.map((cc, j) =>
                j === i ? { ...(tc as TextChild), text: label } : cc,
              );
              setPagePatch(pageId, { children: childrenStage });
            } catch {
              /* ignore individual failure */
            }
          }
        }

        // 2) Update all image children (transform existing; generate placeholders)
        for (let i = 0; i < childrenStage.length; i++) {
          const c = childrenStage[i];
          if (c.type === "image") {
            const ic = c as ImageChild;
            try {
              if (ic.src) {
                const baseB64 = await blobUrlToPngBase64(ic.src);
                const url = await transformImageWithPrompt(
                  baseB64,
                  instructionImage,
                );
                const fitted = await fitImageToRect(url, c.width, c.height);
                childrenStage = childrenStage.map((cc, j) =>
                  j === i
                    ? { ...(cc as ImageChild), src: fitted, placeholder: false }
                    : cc,
                );
                setPagePatch(pageId, { children: childrenStage });
              } else {
                const url = await generateColoringBookImage(instructionImage);
                const fitted = await fitImageToRect(url, c.width, c.height);
                childrenStage = childrenStage.map((cc, j) =>
                  j === i
                    ? { ...(cc as ImageChild), src: fitted, placeholder: false }
                    : cc,
                );
                setPagePatch(pageId, { children: childrenStage });
              }
            } catch {
              /* ignore individual failure */
            }
          }
        }

        // 3) Transform or generate the background
        const baseUrl = page.originalImageUrl || page.imageUrl;
        if (baseUrl) {
          try {
            const baseB64 = await blobUrlToPngBase64(baseUrl);
            const rawUrl = await transformImageWithPrompt(
              baseB64,
              instructionImage,
            );
            const fitted = await fitImageToPrintableArea(rawUrl, page);
            const prev = useEditorStore.getState().pages[pageId];
            if (prev) {
              revokeIfBlob(prev.originalImageUrl);
              revokeIfBlob(prev.imageUrl);
            }
            setPagePatch(pageId, {
              imageUrl: fitted,
              originalImageUrl: fitted,
            });
          } catch {
            // if transform fails, fall back to generate
            try {
              const rawUrl = await generateColoringBookImage(instructionImage);
              const fitted = await fitImageToPrintableArea(rawUrl, page);
              setPagePatch(pageId, {
                imageUrl: fitted,
                originalImageUrl: fitted,
              });
            } catch {
              /* ignore */
            }
          }
        } else {
          try {
            const rawUrl = await generateColoringBookImage(instructionImage);
            const fitted = await fitImageToPrintableArea(rawUrl, page);
            setPagePatch(pageId, {
              imageUrl: fitted,
              originalImageUrl: fitted,
            });
          } catch {
            /* ignore */
          }
        }

        setPagePatch(pageId, { generating: false, status: "" });
      } catch (err) {
        pushToast(
          (err as Error).message || "Failed to generate image",
          "error",
        );
        setPagePatch(pageId, { generating: false, status: "" });
      }
    },
    [buildInstruction, setPagePatch],
  );

  // Define branching after generateInto so dependencies are valid
  const branchFromWithPrompt = useCallback(
    async (parentId: string, prompt: string) => {
      const parent = useEditorStore.getState().pages[parentId];
      if (!parent) return;
      const id = crypto.randomUUID();
      const child: Page = {
        ...parent,
        id,
        title: `${parent.title} variant`,
        prompt,
        generating: true,
        status: "Generating…",
        children: [...(parent.children || [])],
        selectedChildId: null,
      };
      const parentNode = nodes.find((n) => n.id === parentId);
      const newPos = parentNode
        ? { x: parentNode.position.x, y: parentNode.position.y + 480 }
        : { x: 0, y: 480 };
      (actions as any).addEmptyPage?.(child);
      setNodes((ns) => {
        const cleared = ns.map((n) => ({ ...n, selected: false }));
        const newNode: PageRFNode = {
          id: child.id,
          type: "page",
          position: newPos,
          dragHandle: ".dragHandlePage",
          data: { pageId: child.id } as unknown as PageNodeData,
        } as unknown as PageRFNode;
        return cleared.concat({ ...newNode, selected: true });
      });
      setEdges((es) =>
        es.concat({ id: crypto.randomUUID(), source: parentId, target: id }),
      );
      actions.setCurrentPage(id);
      await generateInto(id, prompt, { ...parent, id, prompt });
    },
    [nodes, setNodes, setEdges, actions, generateInto],
  );
  useEffect(() => {
    branchFromWithPromptRef.current = branchFromWithPrompt;
  }, [branchFromWithPrompt]);

  const generateChildFromParent = useCallback(
    async (childId: string, parent: Page, prompt: string) => {
      // If there are placeholders, generate into them on the child
      const placeholders = (parent.children || []).filter(
        (c) => c.type === "image" && !(c as ImageChild).src,
      );
      const childDraft: Page = { ...parent, id: childId, prompt };
      if (placeholders.length) {
        setPagePatch(childId, {
          generating: true,
          status: "Filling placeholders…",
        });
        // clone children array for child
        setPagePatch(childId, { children: [...(parent.children || [])] });
        const instruction = buildInstruction(childDraft, prompt, "image");
        let childrenNext = [...(parent.children || [])];
        for (let i = 0; i < childrenNext.length; i++) {
          const c = childrenNext[i];
          if (c.type === "image" && !(c as ImageChild).src) {
            const url = await generateColoringBookImage(instruction);
            childrenNext = childrenNext.map((cc, j) =>
              j === i
                ? { ...(cc as ImageChild), src: url, placeholder: false }
                : cc,
            );
            setPagePatch(childId, { children: childrenNext });
          }
        }
        setPagePatch(childId, { generating: false, status: "" });
        return;
      }

      // Otherwise prefer transforming the flattened page background
      const flattened = await flattenPageToPng(parent);
      const baseUrl = flattened || parent.originalImageUrl || parent.imageUrl;
      setPagePatch(childId, {
        generating: true,
        status: baseUrl ? "Transforming…" : "Generating…",
      });
      if (baseUrl) {
        try {
          const baseB64 = await blobUrlToPngBase64(baseUrl);
          const instruction = buildInstruction(childDraft, prompt, "image");
          const rawUrl = await transformImageWithPrompt(baseB64, instruction);
          const fitted = await fitImageToPrintableArea(rawUrl, childDraft);
          const prev = useEditorStore.getState().pages[childId];
          revokeIfBlob(prev?.originalImageUrl);
          revokeIfBlob(prev?.imageUrl);
          setPagePatch(childId, {
            imageUrl: fitted,
            originalImageUrl: fitted,
            generating: false,
            status: "",
          });
          return;
        } catch (e) {
          console.warn("Transform failed; falling back to generate", e);
          pushToast("Transform failed. Falling back to generate.", "error");
        }
      }
      await generateInto(childId, prompt, childDraft);
    },
    [buildInstruction, generateInto, setPagePatch],
  );
  useEffect(() => {
    generateChildFromParentRef.current = generateChildFromParent;
  }, [generateChildFromParent]);

  const deleteNode = useCallback(
    (pageId: string) => {
      if (!confirm("Delete this node?")) return;
      // Find parents and children
      const incoming = edges.filter((e) => e.target === pageId);
      const outgoing = edges.filter((e) => e.source === pageId);
      const order = useEditorStore.getState().order;
      const parentId = incoming[0]?.source || order[0]; // reattach to first parent, otherwise root
      const newEdges: Edge[] = edges
        .filter((e) => e.source !== pageId && e.target !== pageId) // remove edges touching deleted
        .concat(
          outgoing.map((childEdge) => ({
            id: crypto.randomUUID(),
            source: parentId!,
            target: childEdge.target,
          })),
        );
      setEdges(newEdges);
      (actions as any).deletePage?.(pageId);
      setNodes((ns) => ns.filter((n) => n.id !== pageId));
      if (currentPageId === pageId) actions.setCurrentPage(parentId!);
    },
    [edges, currentPageId, setEdges, setNodes, actions],
  );
  useEffect(() => {
    deleteNodeRef.current = deleteNode;
  }, [deleteNode]);

  // Keep node list in sync with page list (preserve selection)
  const pagesIdsRef = useRef<string>("");
  const lastCurrentPageIdRef = useRef<string | null>(null);
  useEffect(() => {
    const idsSig = pages.map((p) => p.id).join("|");
    const onlyContentChanged =
      idsSig === pagesIdsRef.current &&
      currentPageId === lastCurrentPageIdRef.current;
    if (onlyContentChanged) return; // avoid calling setState every render
    pagesIdsRef.current = idsSig;
    lastCurrentPageIdRef.current = currentPageId;
    setNodes((old) => {
      const next = pages.map((p, i) => {
        const existing = old.find((n) => n.id === p.id);
        const pos = existing?.position || {
          x: (i % 3) * 380,
          y: Math.floor(i / 3) * 480,
        };
        const node: PageRFNode = {
          id: p.id,
          type: "page",
          position: pos,
          dragHandle: ".dragHandlePage",
          data: {
            pageId: p.id,
            onBranch: (id: string) => branchFromRef.current(id),
            onBranchWithPrompt: (id: string, prompt: string) =>
              branchFromWithPromptRef.current(id, prompt),
            onQuickGenerate: (id: string) => quickGenerateRef.current(id),
            onDelete: (id: string) => deleteNodeRef.current(id),
          } as unknown as PageNodeData,
          selected: existing?.selected ?? p.id === currentPageId,
        } as unknown as PageRFNode;
        return node;
      });
      const equal =
        old.length === next.length &&
        old.every((o, idx) => {
          const n = next[idx];
          return (
            o.id === n.id &&
            o.selected === n.selected &&
            o.position.x === n.position.x &&
            o.position.y === n.position.y &&
            (o.data as any).pageId === (n.data as any).pageId
          );
        });
      return equal ? old : next;
    });
  }, [pages, currentPageId, setNodes]);

  // Drop & paste handlers and keyboard shortcuts via hooks
  const flowRef = useRef<HTMLDivElement | null>(null);
  useDropAndPasteImport(
    flowRef,
    (url, title) => {
      addPageFromImage(url, title);
    },
    (msg) => pushToast(msg, "error"),
  );
  useKeyboardShortcuts({
    onQuickGenerate: () => {
      if (currentPageId) void quickGenerate(currentPageId);
    },
    onDeleteSelected: () => {
      const selected = nodes.filter((n) => n.selected).map((n) => n.id);
      if (selected.length > 1) deleteNodes(selected);
      else if (currentPageId) deleteNode(currentPageId);
    },
  });

  // Simple BW threshold processing (apply to current page using originalImageUrl)

  // Export to PDF (letter)

  async function exportPagesToPdf(pagesToExport: Page[]) {
    if (!pagesToExport.length) return;
    const first = pagesToExport[0];
    const pdf = new jsPDF({
      orientation: first.orientation,
      unit: "in",
      format: "letter",
    });
    for (let i = 0; i < pagesToExport.length; i++) {
      const page = pagesToExport[i];
      if (!page.children?.length && !page.imageUrl) continue;
      if (i > 0) pdf.addPage("letter", page.orientation);
      try {
        await addPageToJsPdf(pdf, page);
      } catch {
        /* skip page on error */
      }
    }
    pdf.save("checkfu.pdf");
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header
        className="h-14 px-4 border-b border-slate-200 bg-sky-50/60 backdrop-blur flex items-center justify-between"
        role="toolbar"
        aria-label="Editor top bar"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold">Checkfu</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm disabled:opacity-50"
            aria-label="Export to PDF"
            disabled={!pages.length}
            onClick={() => {
              const selected = nodes
                .filter((n) => n.selected)
                .map((n) => useEditorStore.getState().pages[n.id])
                .filter(Boolean) as Page[];
              const toExport = selected.length
                ? selected
                : currentPage
                  ? [currentPage]
                  : [];
              if (!toExport.length) return;
              void exportPagesToPdf(toExport);
            }}
          >
            <span>Export to PDF</span>
            {nodes.filter((n) => n.selected).length > 1 ? (
              <span
                className="px-1.5 h-5 min-w-[1.25rem] inline-flex items-center justify-center rounded bg-blue-100 text-blue-800 text-xs"
                aria-label="Selected count"
              >
                {nodes.filter((n) => n.selected).length}
              </span>
            ) : null}
          </button>
          <button
            className={`px-3 py-1.5 rounded-md border text-sm inline-flex items-center gap-2 ${needsApiKey ? "border-amber-400 bg-amber-50 text-amber-800" : ""}`}
            aria-label="Settings"
            title={
              needsApiKey
                ? "Add your Gemini API key to generate images"
                : "API Key"
            }
            onClick={() => setShowSettings(true)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 2.4l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .63.37 1.2.95 1.45.33.14.68.27 1.05.37" />
            </svg>
            {needsApiKey ? "Add API Key" : "API Key"}
          </button>
        </div>
      </header>

      {/* Main grid */}
      <div
        className="h-[calc(100vh-56px)] grid"
        style={{ gridTemplateColumns: "260px 1fr 320px" }}
      >
        {/* Left sidebar (Pages and Palette) */}
        <aside
          className="border-r border-slate-200 bg-sky-50/30 flex flex-col"
          role="complementary"
          aria-label="Left sidebar"
        >
          {/* Simple palette */}
          <div className="p-2 border-b border-sky-100 flex items-center justify-between">
            <div className="text-sm font-medium">Palette</div>
          </div>
          <div className="px-3 pt-2 pb-2 border-b border-slate-100 flex items-center gap-2">
            <button
              className="px-2 py-1 border rounded text-xs"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/checkfu-node",
                  JSON.stringify({ kind: "text" }),
                );
              }}
              title="Drag onto a page to create a Text node"
            >
              Text
            </button>
            <button
              className="px-2 py-1 border rounded text-xs"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/checkfu-node",
                  JSON.stringify({ kind: "image" }),
                );
              }}
              title="Drag onto a page to create an Image node (opens file picker)"
            >
              Image
            </button>
            <div className="text-[11px] text-slate-600">
              Or drop an image file onto a page
            </div>
          </div>
          <div className="p-2 border-b border-sky-100 flex items-center justify-between">
            <div className="text-sm font-medium">Pages</div>
            <button
              className="px-2 py-1 text-sm border rounded inline-flex items-center gap-1"
              title="Create a new page"
              onClick={() => {
                const id = crypto.randomUUID();
                const p: Page = {
                  id,
                  title: "New Page",
                  orientation: "portrait",
                  bwThreshold: DEFAULT_THRESHOLD,
                  pageType: "coloring",
                  coloringStyle: "classic",
                  standards: [],
                  systemPrompt: "",
                  systemPromptEdited: false,
                  children: [],
                  selectedChildId: null,
                };
                (actions as any).addEmptyPage?.(p);
                actions.setCurrentPage(p.id);
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New
            </button>
          </div>
          <div
            className="p-3 overflow-auto grow"
            role="region"
            aria-label="Pages list"
          >
            {pages.length === 0 ? (
              <div className="h-full grid place-items-center text-slate-500">
                <div className="text-center max-w-[220px]">
                  <div className="mx-auto mb-2 h-10 w-10 rounded-full border border-dashed border-slate-300 grid place-items-center text-slate-400">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect
                        x="3"
                        y="4"
                        width="18"
                        height="14"
                        rx="2"
                        ry="2"
                      ></rect>
                      <path d="M8 22h8"></path>
                    </svg>
                  </div>
                  <div className="text-sm">No pages yet</div>
                  <div className="text-xs mt-1">
                    Click <span className="font-medium">New</span> or drop/paste
                    an image to start.
                  </div>
                </div>
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {pages.map((p) => {
                  const selectedIds = new Set(
                    nodes.filter((n) => n.selected).map((n) => n.id),
                  );
                  const isSelected = selectedIds.has(p.id);
                  const isActive = currentPageId === p.id;
                  const childCount = (p.children || []).length;
                  return (
                    <li key={p.id}>
                      <button
                        id={`page-item-${p.id}`}
                        className={`w-full text-left px-2 py-1 rounded transition-colors hover:bg-slate-100 ${isSelected ? "bg-slate-100" : ""} ${isActive ? "ring-1 ring-blue-500 bg-blue-50 border-l-2 border-blue-500" : ""}`}
                        aria-pressed={isSelected}
                        aria-current={isActive ? "page" : undefined}
                        onClick={(e) => {
                          const isToggle = e.metaKey || e.ctrlKey;
                          actions.setCurrentPage(p.id);
                          if (isToggle) {
                            setNodes((ns) =>
                              ns.map((n) =>
                                n.id === p.id
                                  ? { ...n, selected: !n.selected }
                                  : n,
                              ),
                            );
                          } else {
                            setNodes((ns) =>
                              ns.map((n) => ({
                                ...n,
                                selected: n.id === p.id,
                              })),
                            );
                          }
                        }}
                      >
                        <span className="flex items-center justify-between">
                          <span className="truncate flex items-center gap-2">
                            <span className="truncate">{p.title}</span>
                            <span className="text-[10px] px-1 py-[1px] rounded bg-slate-200 text-slate-800">
                              {childCount}
                            </span>
                          </span>
                          <span className="ml-2">
                            {isActive ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 align-middle">
                                Active
                              </span>
                            ) : isSelected ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 align-middle">
                                Selected
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                      {/* Children (show when active page) */}
                      {isActive && childCount > 0 ? (
                        <ul className="ml-3 mt-1 mb-2 space-y-0.5">
                          {(p.children || []).map((c) => (
                            <li key={c.id}>
                              <button
                                className={`w-full px-2 py-1 rounded text-left hover:bg-slate-100 ${p.selectedChildId === c.id ? "bg-slate-100 ring-1 ring-slate-300" : ""}`}
                                onClick={() => {
                                  actions.setCurrentPage(p.id);
                                  setPagePatch(p.id, { selectedChildId: c.id });
                                  setNodes((ns) =>
                                    ns.map((n) => ({
                                      ...n,
                                      selected: n.id === p.id,
                                    })),
                                  );
                                }}
                              >
                                <span className="flex items-center gap-2 text-xs text-slate-700">
                                  <span
                                    className="inline-block w-3 h-3 rounded-sm border border-slate-300 bg-white"
                                    aria-hidden
                                  />
                                  <span className="truncate">
                                    {c.type === "text"
                                      ? `Text: ${((c as TextChild).text || "").slice(0, 24)}`
                                      : (c as ImageChild).src
                                        ? "Image"
                                        : "Image (placeholder)"}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Graph */}
        <main className="bg-muted/20 overflow-hidden" aria-label="Graph editor">
          <div className="w-full h-full" ref={flowRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={RF_FIT_VIEW_OPTIONS}
              defaultViewport={RF_DEFAULT_VIEWPORT}
              minZoom={0.05}
              maxZoom={2.5}
              translateExtent={RF_TRANSLATE_EXTENT}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClickStable}
              onConnect={onConnectStable}
              noPanClassName="nopan"
              noDragClassName="nodrag"
              noWheelClassName="nowheel"
            >
              <Background />
              <Controls className="no-print" />
            </ReactFlow>
          </div>
        </main>

        {/* Inspector with Layers and Properties */}
        <aside
          className="border-l border-slate-200 bg-sky-50/30 p-3 overflow-auto"
          aria-label="Inspector"
        >
          {!currentPage ? (
            <div className="text-sm text-muted-foreground">
              Create your first page with the New button or drop/paste an image.
            </div>
          ) : (
            <div className="space-y-6 text-sm">
              {!currentPage.selectedChildId && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-700">Page</h3>
                  <div className="mt-2 grid gap-2">
                    <label htmlFor="page-title">Title</label>
                    <input
                      id="page-title"
                      className="border rounded px-2 py-1"
                      value={currentPage?.title || ""}
                      onChange={(e) =>
                        setPagePatch(currentPageId!, { title: e.target.value })
                      }
                    />
                    <label htmlFor="page-orientation">Orientation</label>
                    <select
                      id="page-orientation"
                      className="border rounded px-2 py-1"
                      value={currentPage?.orientation || "portrait"}
                      onChange={(e) =>
                        setPagePatch(currentPageId!, {
                          orientation: e.target.value as Orientation,
                        })
                      }
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                    {/* Margin removed per spec */}
                  </div>
                </section>
              )}

              {/* Page prompts removed: prompting is node-only */}

              {/* Child inspector only when a child is selected */}
              {currentPage.selectedChildId ? (
                <section>
                  {(() => {
                    const ch = (currentPage.children || []).find(
                      (c) => c.id === currentPage.selectedChildId,
                    );
                    const hdr = ch?.type === "text" ? "Text" : "Image";
                    return (
                      <h3 className="text-sm font-semibold text-slate-700">
                        {hdr}
                      </h3>
                    );
                  })()}
                  {(() => {
                    const child = (currentPage.children || []).find(
                      (c) => c.id === currentPage.selectedChildId,
                    );
                    if (!child) return null;
                    const isText = child.type === "text";
                    return (
                      <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-2 items-center">
                          <label className="text-xs">X</label>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            value={child.x}
                            onChange={(e) => {
                              const v = parseFloat(
                                e.currentTarget.value || "0",
                              );
                              setPagePatch(currentPageId!, {
                                children: (currentPage.children || []).map(
                                  (c) =>
                                    c.id === child.id ? { ...c, x: v } : c,
                                ),
                              });
                            }}
                          />
                          <label className="text-xs">Y</label>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            value={child.y}
                            onChange={(e) => {
                              const v = parseFloat(
                                e.currentTarget.value || "0",
                              );
                              setPagePatch(currentPageId!, {
                                children: (currentPage.children || []).map(
                                  (c) =>
                                    c.id === child.id ? { ...c, y: v } : c,
                                ),
                              });
                            }}
                          />
                          <label className="text-xs">Width</label>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            disabled={isText}
                            title={
                              isText ? "Width snaps to text content" : undefined
                            }
                            value={child.width}
                            onChange={(e) => {
                              const v = parseFloat(
                                e.currentTarget.value || "0",
                              );
                              setPagePatch(currentPageId!, {
                                children: (currentPage.children || []).map(
                                  (c) =>
                                    c.id === child.id ? { ...c, width: v } : c,
                                ),
                              });
                            }}
                          />
                          <label className="text-xs">Height</label>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            disabled={isText}
                            title={
                              isText
                                ? "Height snaps to text content"
                                : undefined
                            }
                            value={child.height}
                            onChange={(e) => {
                              const v = parseFloat(
                                e.currentTarget.value || "0",
                              );
                              setPagePatch(currentPageId!, {
                                children: (currentPage.children || []).map(
                                  (c) =>
                                    c.id === child.id ? { ...c, height: v } : c,
                                ),
                              });
                            }}
                          />
                          <label className="text-xs">Angle</label>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            value={child.angle || 0}
                            onChange={(e) => {
                              const v = parseFloat(
                                e.currentTarget.value || "0",
                              );
                              setPagePatch(currentPageId!, {
                                children: (currentPage.children || []).map(
                                  (c) =>
                                    c.id === child.id ? { ...c, angle: v } : c,
                                ),
                              });
                            }}
                          />
                        </div>

                        {/* Prompt Library (node-local selection; default None) */}
                        <div className="grid gap-1">
                          <label htmlFor="prompt-preset">Prompt Library</label>
                          <select
                            id="prompt-preset"
                            className="border rounded px-2 py-1"
                            value={nodePresets[child.id] ?? "none"}
                            onChange={(e) => {
                              const v = e.currentTarget.value;
                              setNodePresets((m) => ({ ...m, [child.id]: v }));
                              if (v === "none") return;
                              const [type, style] = v.includes(":")
                                ? v.split(":")
                                : [v, ""];
                              const simulated: Page = {
                                ...currentPage!,
                                pageType: type as Page["pageType"],
                                coloringStyle:
                                  (style as Page["coloringStyle"]) ||
                                  currentPage.coloringStyle,
                              } as Page;
                              const sys = computeSystemPrompt(
                                simulated,
                                standardsCatalog,
                              );
                              setNodePrompts((m) => ({
                                ...m,
                                [child.id]: sys,
                              }));
                            }}
                          >
                            <option value="none">None</option>
                            <option value={"coloring:classic"}>
                              Coloring Book — Classic
                            </option>
                            <option value={"coloring:anime"}>
                              Coloring Book — Anime
                            </option>
                            <option value={"coloring:retro"}>
                              Coloring Book — Retro
                            </option>
                            <option value={"worksheet"}>
                              Worksheet — K Math
                            </option>
                          </select>
                        </div>
                        {/* Compact Knowledge picker (standards) */}
                        <div className="grid gap-1">
                          <label>Knowledge (Standards)</label>
                          <CompactStandardsPicker
                            options={standardsCatalog}
                            value={currentPage?.standards || []}
                            onChange={(vals) =>
                              setPagePatch(currentPageId!, {
                                standards: vals,
                                systemPromptEdited: false,
                              })
                            }
                          />
                        </div>
                        {child.type === "text" ? (
                          <div className="grid gap-3">
                            <div className="grid grid-cols-2 gap-2 items-center">
                              <label className="text-xs">Text</label>
                              <input
                                className="border rounded px-2 py-1"
                                value={(child as TextChild).text || ""}
                                onChange={(e) =>
                                  setPagePatch(currentPageId!, {
                                    children: (currentPage.children || []).map(
                                      (c) =>
                                        c.id === child.id
                                          ? {
                                              ...(c as TextChild),
                                              text: e.currentTarget.value,
                                            }
                                          : c,
                                    ),
                                  })
                                }
                              />
                              <label className="text-xs">Font Size</label>
                              <input
                                className="border rounded px-2 py-1"
                                type="number"
                                value={(child as TextChild).fontSize || 24}
                                onChange={(e) =>
                                  setPagePatch(currentPageId!, {
                                    children: (currentPage.children || []).map(
                                      (c) =>
                                        c.id === child.id
                                          ? {
                                              ...(c as TextChild),
                                              fontSize: parseFloat(
                                                e.currentTarget.value || "24",
                                              ),
                                            }
                                          : c,
                                    ),
                                  })
                                }
                              />
                              <label className="text-xs">Align</label>
                              <select
                                className="border rounded px-2 py-1"
                                value={(child as TextChild).align || "left"}
                                onChange={(e) =>
                                  setPagePatch(currentPageId!, {
                                    children: (currentPage.children || []).map(
                                      (c) =>
                                        c.id === child.id
                                          ? {
                                              ...(c as TextChild),
                                              align: e.currentTarget
                                                .value as TextChild["align"],
                                            }
                                          : c,
                                    ),
                                  })
                                }
                              >
                                <option value="left">Left</option>
                                <option value="center">Center</option>
                                <option value="right">Right</option>
                              </select>
                            </div>
                            {/* Prompt for text */}
                            <div className="grid gap-1">
                              <label htmlFor="quick-prompt-text">Prompt</label>
                              <textarea
                                id="quick-prompt-text"
                                className="border rounded px-2 py-1 h-24"
                                placeholder="e.g., write 5 sentences about shapes"
                                value={nodePrompts[child.id] ?? ""}
                                onChange={(e) =>
                                  setNodePrompts((m) => ({
                                    ...m,
                                    [child.id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                className="px-2 py-1 border rounded disabled:opacity-50 w-max"
                                disabled={generatingAny}
                                onClick={async () => {
                                  const promptText = (
                                    nodePrompts[child.id] ?? ""
                                  ).trim();
                                  try {
                                    setPagePatch(currentPageId!, {
                                      generating: true,
                                      status: "Generating text…",
                                    });
                                    const textPrompt = [
                                      buildInstruction(
                                        currentPage!,
                                        promptText,
                                        "text",
                                      ),
                                      "You are updating a single text label on a printable page.",
                                      "Return only the new text, no commentary.",
                                      `Current text: "${(child as TextChild).text || ""}"`,
                                    ].join("\n");
                                    const out =
                                      await generateTextContent(textPrompt);
                                    const label = cleanSingleLineLabel(out);
                                    setPagePatch(currentPageId!, {
                                      children: (
                                        currentPage?.children || []
                                      ).map((c) =>
                                        c.id === child.id
                                          ? { ...(c as TextChild), text: label }
                                          : c,
                                      ),
                                      generating: false,
                                      status: "",
                                    });
                                  } catch (err) {
                                    setPagePatch(currentPageId!, {
                                      generating: false,
                                      status: "",
                                    });
                                    pushToast(
                                      (err as Error)?.message ||
                                        "Failed to generate text",
                                      "error",
                                    );
                                  }
                                }}
                              >
                                {generatingAny ? "Generating…" : "Generate"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {/* Prompt for image */}
                            <div className="grid gap-1">
                              <label htmlFor="quick-prompt-image">Prompt</label>
                              <textarea
                                id="quick-prompt-image"
                                className="border rounded px-2 py-1 h-24"
                                placeholder="Describe the change to this image"
                                value={nodePrompts[child.id] ?? ""}
                                onChange={(e) =>
                                  setNodePrompts((m) => ({
                                    ...m,
                                    [child.id]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="text-xs text-slate-600">
                              {(child as ImageChild).src
                                ? "Image set"
                                : "Placeholder image (X)"}
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="px-2 py-1 border rounded text-xs"
                                onClick={() => {
                                  const input = document.createElement("input");
                                  input.type = "file";
                                  input.accept = "image/*";
                                  input.onchange = () => {
                                    const file = input.files?.[0];
                                    if (!file) return;
                                    const url = URL.createObjectURL(file);
                                    const next = (
                                      currentPage.children || []
                                    ).map((c) =>
                                      c.id === child.id
                                        ? {
                                            ...(c as ImageChild),
                                            src: url,
                                            placeholder: false,
                                          }
                                        : c,
                                    );
                                    // revoke old blob if present
                                    const old = (child as ImageChild).src;
                                    if (old && old.startsWith("blob:")) {
                                      try {
                                        URL.revokeObjectURL(old);
                                      } catch {}
                                    }
                                    setPagePatch(currentPageId!, {
                                      children: next,
                                    });
                                  };
                                  input.click();
                                }}
                              >
                                Upload Image
                              </button>
                              <button
                                className="px-2 py-1 border rounded text-xs"
                                onClick={async () => {
                                  try {
                                    setPagePatch(currentPageId!, {
                                      generating: true,
                                      status: "Generating image…",
                                    });
                                    const instruction = buildInstruction(
                                      currentPage!,
                                      nodePrompts[child.id] ?? "",
                                      "image",
                                    );
                                    const ic = child as ImageChild;
                                    let url: string;
                                    if (ic.src) {
                                      const b64 = await blobUrlToPngBase64(
                                        ic.src,
                                      );
                                      url = await transformImageWithPrompt(
                                        b64,
                                        instruction,
                                      );
                                    } else {
                                      url =
                                        await generateColoringBookImage(
                                          instruction,
                                        );
                                    }
                                    // Fit generated image to this node's rectangle (trim borders, preserve aspect)
                                    const fitted = await fitImageToRect(
                                      url,
                                      child.width,
                                      child.height,
                                    );
                                    const next = (
                                      currentPage.children || []
                                    ).map((c) =>
                                      c.id === child.id
                                        ? {
                                            ...(c as ImageChild),
                                            src: fitted,
                                            placeholder: false,
                                          }
                                        : c,
                                    );
                                    setPagePatch(currentPageId!, {
                                      children: next,
                                      generating: false,
                                      status: "",
                                    });
                                  } catch (err) {
                                    setPagePatch(currentPageId!, {
                                      generating: false,
                                      status: "",
                                    });
                                    pushToast(
                                      (err as Error)?.message ||
                                        "Failed to generate image",
                                      "error",
                                    );
                                  }
                                }}
                              >
                                Generate
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </section>
              ) : null}

              {/* Import (page only) */}
              {!currentPage.selectedChildId && (
                <section>
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Import
                  </h3>
                  <div className="mt-2 grid gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        if (!f) return;
                        if (f.size > 8 * 1024 * 1024) {
                          pushToast("File too large (max 8 MB)", "error");
                          return;
                        }
                        const url = URL.createObjectURL(f);
                        const prev = currentPageId
                          ? useEditorStore.getState().pages[currentPageId]
                          : undefined;
                        revokeIfBlob(prev?.originalImageUrl); // avoid leaks from stale object URLs
                        revokeIfBlob(prev?.imageUrl); // avoid leaks from stale object URLs
                        setPagePatch(currentPageId!, {
                          originalImageUrl: url,
                          imageUrl: url,
                        });
                        void applyThreshold(
                          currentPageId!,
                          (currentPageId
                            ? useEditorStore.getState().pages[currentPageId!]
                                ?.bwThreshold
                            : undefined) ?? DEFAULT_THRESHOLD,
                        );
                      }}
                    />
                  </div>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-3 right-3 z-50 grid gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-3 py-2 rounded shadow text-sm ${t.kind === "error" ? "bg-red-600 text-white" : t.kind === "success" ? "bg-green-600 text-white" : "bg-slate-800 text-white"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
      {/* Settings modal */}
      {branchingParentId && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 bg-black/40 grid place-items-center"
        >
          <div className="bg-white text-black rounded-md shadow-lg p-4 w-[520px] max-w-[92vw]">
            <h2 className="font-semibold mb-2">Refine by Prompt</h2>
            <p className="text-xs text-slate-600 mb-2">
              Describe how to change the current page. The model uses your
              System Prompt and this prompt together.
            </p>
            <textarea
              className="border rounded w-full h-32 px-2 py-1"
              autoFocus
              value={branchPrompt}
              onChange={(e) => setBranchPrompt(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="px-2 py-1 border rounded"
                onClick={() => {
                  setBranchingParentId(null);
                  setBranchPrompt("");
                }}
              >
                Cancel
              </button>
              <button
                className="px-2 py-1 border rounded"
                onClick={() => {
                  const pid = branchingParentId;
                  const p = branchPrompt.trim();
                  setBranchingParentId(null);
                  setBranchPrompt("");
                  if (pid && p) void branchFromWithPrompt(pid, p);
                }}
              >
                Create Variant
              </button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 bg-black/40 grid place-items-center"
        >
          <div className="bg-white text-black rounded-md shadow-lg p-4 w-[420px] max-w-[90vw]">
            <h2 className="font-semibold mb-3">Gemini API Key</h2>
            <p className="text-sm text-slate-600 mb-2">
              Stored in localStorage (use at your own risk).
            </p>
            <input
              id="apikey"
              className="border rounded px-2 py-1 w-full mb-2"
              placeholder="GEMINI_API_KEY"
              defaultValue={
                typeof window !== "undefined"
                  ? localStorage.getItem("CHECKFU_GEMINI_API_KEY") || ""
                  : ""
              }
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-2 py-1 border rounded"
                onClick={() => {
                  localStorage.removeItem("CHECKFU_GEMINI_API_KEY");
                  setShowSettings(false);
                  window.dispatchEvent(
                    new StorageEvent("storage", {
                      key: "CHECKFU_GEMINI_API_KEY",
                    }),
                  );
                }}
              >
                Clear
              </button>
              <button
                className="px-2 py-1 border rounded"
                onClick={() => {
                  const el = document.getElementById(
                    "apikey",
                  ) as HTMLInputElement | null;
                  if (el)
                    localStorage.setItem(
                      "CHECKFU_GEMINI_API_KEY",
                      el.value || "",
                    );
                  setShowSettings(false);
                  window.dispatchEvent(
                    new StorageEvent("storage", {
                      key: "CHECKFU_GEMINI_API_KEY",
                    }),
                  );
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Module: StandardsMultiSelect — compact multi-select with simple search
 */
// Old tall standards picker removed; using CompactStandardsPicker above.

// Compact, low-height standards picker with suggestions
function CompactStandardsPicker({
  options,
  value,
  onChange,
}: {
  options: { code: string; description: string }[];
  value: string[];
  onChange: (vals: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addByCode = (code: string) => {
    const normalized = code.trim();
    if (!normalized) return;
    const exists = options.some(
      (o) => o.code.toLowerCase() === normalized.toLowerCase(),
    );
    const picked = exists
      ? options.find((o) => o.code.toLowerCase() === normalized.toLowerCase())!
          .code
      : options.find((o) =>
          (o.description || "")
            .toLowerCase()
            .includes(normalized.toLowerCase()),
        )?.code;
    if (!picked) return;
    if (!value.includes(picked)) onChange([...value, picked]);
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          list="k-standards-datalist"
          placeholder="Add standard (e.g., K.OA.1)"
          className="border rounded px-2 py-1 text-sm flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addByCode((e.currentTarget as HTMLInputElement).value || "");
            }
          }}
        />
        <button
          className="px-2 py-1 border rounded text-xs"
          onClick={() => addByCode(inputRef.current?.value || "")}
        >
          Add
        </button>
      </div>
      <datalist id="k-standards-datalist">
        {options.slice(0, 400).map((o) => (
          <option key={o.code} value={o.code} label={o.description} />
        ))}
      </datalist>
      <div className="flex flex-wrap gap-1">
        {value.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-slate-200"
          >
            {code}
            <button
              className="ml-1 text-slate-600 hover:text-slate-900"
              onClick={() => onChange(value.filter((v) => v !== code))}
              aria-label={`Remove ${code}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
