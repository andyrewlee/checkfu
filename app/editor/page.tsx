"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, addEdge, applyNodeChanges } from "@xyflow/react";
import type { Edge, Node as RFNode, NodeChange, Connection, NodeTypes } from "@xyflow/react";
import { jsPDF } from "jspdf";
import PageNode, { type PageNodeData } from "@/components/nodes/PageNode";
import { useRef as useReactRef } from 'react';

type Orientation = "portrait" | "landscape";
// Left sidebar is always Pages now (no tabs)

type Page = {
  id: string;
  title: string;
  orientation: Orientation;
  marginInches: number;
  imageUrl?: string; // processed/display URL (object URL or dataURL)
  originalImageUrl?: string; // source before BW processing
  prompt?: string;
  systemPrompt?: string;
  systemPromptEdited?: boolean;
  bwThreshold?: number; // 0-255
  pageType?: 'worksheet' | 'coloring';
  coloringStyle?: 'classic' | 'anime' | 'retro' | 'storybook';
  standards?: string[];
};

// EditorPage: Node-based generator for printable K–1 pages.
// - Graph of Page nodes (React Flow)
// - Each Page is a single 8.5×11 image with margins
// - Branching uses the parent image + prompt to create a child variant
// - Inspector manages Page Type, K standards, style, System Prompt + Prompt
export default function EditorPage() {
  const [pages, setPages] = useState<Page[]>(() => []);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const currentPage = currentPageId ? (pages.find((p) => p.id === currentPageId) ?? null) : null;
  type PageRFNode = RFNode<PageNodeData, 'page'>;
  const [nodes, setNodes] = useState<PageRFNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Loaded CCSS Kindergarten standards catalog (code + description)
  const [standardsCatalog, setStandardsCatalog] = useState<{ code: string; description: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/ccss_kindergarten_math_standards.json');
        if (!res.ok) return;
        const data = await res.json();
        const flat: { code: string; description: string }[] = [];
        for (const d of data.domains || []) {
          for (const c of d.clusters || []) {
            for (const s of c.standards || []) {
              if (s.code && s.description) flat.push({ code: s.code, description: s.description });
              if (Array.isArray(s.components)) {
                for (const comp of s.components) {
                  if (comp.code && comp.description) flat.push({ code: comp.code, description: comp.description });
                }
              }
            }
          }
        }
        if (!cancelled) setStandardsCatalog(flat);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const [toasts, setToasts] = useState<{ id: string; kind: 'error'|'info'|'success'; text: string }[]>([]);
  const lastQuickGenAtRef = useRef<number>(0);
  // Keep current page visible in the sidebar
  useEffect(() => {
    if (!currentPageId) return;
    const el = document.getElementById(`page-item-${currentPageId}`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPageId]);
  // Inpainting modal state
  const [showInpaint, setShowInpaint] = useState(false);

  // Memoize nodeTypes to avoid React Flow warning about new object each render
  const nodeTypes = useMemo<NodeTypes>(() => ({ page: PageNode as any }), []);

  function pushToast(text: string, kind: 'error'|'info'|'success' = 'info') {
    const id = crypto.randomUUID();
    setToasts((ts) => ts.concat({ id, kind, text }));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000);
  }

  // Helper to build a React Flow node from a Page
  function buildNode(p: Page, position: { x: number; y: number }): PageRFNode {
    return {
      id: p.id,
      type: 'page',
      position,
      data: {
        id: p.id,
        title: p.title,
        orientation: p.orientation,
        marginInches: p.marginInches,
        imageUrl: p.imageUrl,
        onBranch: (pid) => branchFrom(pid),
        onBranchWithPrompt: (pid, prompt) => branchFromWithPrompt(pid, prompt),
        onDelete: (pid) => deleteNode(pid),
        onQuickGenerate: (pid) => quickGenerate(pid),
      },
    };
  }

  // Keep node list in sync with page list (preserve selection)
  useEffect(() => {
    setNodes((old) =>
      pages.map((p, i) => {
        const existing = old.find((n) => n.id === p.id);
        const pos = existing?.position || { x: (i % 3) * 380, y: Math.floor(i / 3) * 480 };
        const node = buildNode(p, pos);
        return { ...node, selected: existing?.selected ?? (p.id === currentPageId) };
      })
    );
  }, [pages, currentPageId]);

  const onNodesChange = (changes: NodeChange<PageRFNode>[]) =>
    setNodes((ns) => applyNodeChanges<PageRFNode>(changes, ns));

  function setPagePatch(id: string, patch: Partial<Page>) {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  // Compute printable area size in CSS pixels (96 DPI reference)
  function computePrintablePx(p: Page): { pxW: number; pxH: number } {
    const DPI = 96;
    const pageWIn = p.orientation === 'portrait' ? 8.5 : 11;
    const pageHIn = p.orientation === 'portrait' ? 11 : 8.5;
    const imgWIn = pageWIn - 2 * (p.marginInches || 0);
    const imgHIn = pageHIn - 2 * (p.marginInches || 0);
    return { pxW: Math.max(1, Math.round(imgWIn * DPI)), pxH: Math.max(1, Math.round(imgHIn * DPI)) };
  }

  // Fit any image URL to exactly the printable area (cover crop to fill) and return a PNG data URL.
  // Also auto-trims outer white margins and lightly crops inside any heavy border lines.
  async function fitImageToPrintableArea(url: string, p: Page): Promise<string> {
    const { pxW, pxH } = computePrintablePx(p);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load failed')); img.src = url; });
    const rT = pxW / pxH;

    // First, auto-trim outer white margins from the source to remove unnecessary gutters around content.
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width; srcCanvas.height = img.height;
    const srcCtx = srcCanvas.getContext('2d'); if (!srcCtx) return url;
    srcCtx.drawImage(img, 0, 0);
    const data = srcCtx.getImageData(0, 0, img.width, img.height).data;
    const isWhite = (idx: number) => {
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      if (a < 8) return true; // treat near-transparent as white background
      // luminance threshold; allow very light gray
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return y > 250;
    };
    let top = 0, bottom = img.height - 1, left = 0, right = img.width - 1;
    // scan from top
    scanTop: for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        if (!isWhite(i)) { top = Math.max(0, y - 1); break scanTop; }
      }
    }
    // scan from bottom
    scanBottom: for (let y = img.height - 1; y >= 0; y--) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        if (!isWhite(i)) { bottom = Math.min(img.height - 1, y + 1); break scanBottom; }
      }
    }
    // scan from left
    scanLeft: for (let x = 0; x < img.width; x++) {
      for (let y = 0; y < img.height; y += 2) {
        const i = (y * img.width + x) * 4;
        if (!isWhite(i)) { left = Math.max(0, x - 1); break scanLeft; }
      }
    }
    // scan from right
    scanRight: for (let x = img.width - 1; x >= 0; x--) {
      for (let y = 0; y < img.height; y += 2) {
        const i = (y * img.width + x) * 4;
        if (!isWhite(i)) { right = Math.min(img.width - 1, x + 1); break scanRight; }
      }
    }
    let sx = Math.max(0, left), sy = Math.max(0, top);
    let sw = Math.max(1, right - left + 1), sh = Math.max(1, bottom - top + 1);

    // Lightly crop inside any heavy border lines by a few pixels (bleed), if the trim changed the rect.
    const bleed = 4;
    if (sw < img.width || sh < img.height) {
      sx = Math.min(Math.max(0, sx + bleed), img.width - 1);
      sy = Math.min(Math.max(0, sy + bleed), img.height - 1);
      sw = Math.max(1, Math.min(img.width - sx, sw - bleed * 2));
      sh = Math.max(1, Math.min(img.height - sy, sh - bleed * 2));
    }

    // Now apply cover-crop within the trimmed rect to match the printable aspect ratio exactly.
    const rS = sw / sh;
    if (!isFinite(rS) || sw === 0 || sh === 0) {
      // fallback: contain
      const c = document.createElement('canvas'); c.width = pxW; c.height = pxH; const ctx = c.getContext('2d'); if (!ctx) return url;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,pxW,pxH);
      const scale = Math.min(pxW / Math.max(1, img.width), pxH / Math.max(1, img.height));
      const dw = Math.round(img.width * scale), dh = Math.round(img.height * scale);
      const dx = Math.floor((pxW - dw)/2), dy = Math.floor((pxH - dh)/2);
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
      return c.toDataURL('image/png');
    }
    if (rS > rT) {
      // source wider → crop width inside trimmed rect
      const newSw = Math.round(sh * rT);
      sx = Math.floor(sx + (sw - newSw) / 2);
      sw = newSw;
    } else if (rS < rT) {
      // source taller → crop height inside trimmed rect
      const newSh = Math.round(sw / rT);
      sy = Math.floor(sy + (sh - newSh) / 2);
      sh = newSh;
    }
    const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
    const ctx = c.getContext('2d'); if (!ctx) return url;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, pxW, pxH);
    return c.toDataURL('image/png');
  }

  // Build an explicit, printing-oriented System Prompt from selections
  function computeSystemPrompt(p: Page): string {
    const isWorksheet = (p.pageType || 'worksheet') === 'worksheet';
    if (isWorksheet) {
      const selected = (p.standards || []);
      const codes = selected.join(', ');
      const lookup = new Map(standardsCatalog.map(s => [s.code, s.description] as const));
      const descs = selected.map(code => `${code}: ${lookup.get(code) || ''}`).filter(Boolean);
      const cc = codes ? `Common Core Kindergarten focus: ${codes}. ` : 'Common Core Kindergarten math practices. ';
      const ccDetail = descs.length ? `Target standards details: ${descs.join('; ')}. ` : '';
      const goal = 'Design a solvable, self-contained worksheet a kindergarten student can complete independently. Provide a single clear task/instruction and space to answer. Use concrete visual math tools (ten frames, number lines, dot cards, simple manipulatives). Quantities ≤ 10. '; 
      const layout = 'Balance composition for print. Include obvious answer areas (blank boxes/frames/lines) with ample white space. Keep one main task per page. High contrast. Fill the printable area inside margins; avoid borders, frames, titles, or page headers.'; 
      const style = 'Black ink line art only. Thick outlines. White background. No shading or gray. Letter-size proportion (8.5×11). No decorative frames or captions. Minimal text; numerals OK.';
      return `${cc}${ccDetail}${goal}${layout}${style}`.trim();
    } else {
      const styleName = p.coloringStyle || 'classic';
      const styleText = styleName === 'anime' ? 'Anime style; clean inked outlines; large fill areas.'
        : styleName === 'retro' ? 'Retro 1960s cartoon style; bold outlines; simple shapes.'
        : styleName === 'storybook' ? 'Classic Western storybook sketch style; bold outlines; simple shapes.'
        : 'Classic coloring book style; bold outlines; large shapes.';
      const base = 'Black ink line art only. White background. No shading or gray. Letter-size proportion (8.5×11). Fill the printable area inside margins. Do not include frames, borders, titles, or headers.';
      return `${styleText} ${base}`.trim();
    }
  }

  // Auto-refresh system prompt when selections change unless edited
  useEffect(() => {
    setPages((ps) => ps.map((p) => {
      if (p.id !== currentPageId) return p;
      if (p.systemPromptEdited) return p;
      const sys = computeSystemPrompt(p);
      return { ...p, systemPrompt: sys };
    }));
  }, [currentPage?.pageType, currentPage?.coloringStyle, (currentPage?.standards || []).join('|')]);

  function addPageFromImage(url: string, title = "Image", overrides?: Partial<Page>): string {
    const id = crypto.randomUUID();
    const newPage: Page = {
      id,
      title,
      orientation: "portrait",
      marginInches: 0.5,
      originalImageUrl: url,
      imageUrl: url,
      bwThreshold: 200,
      pageType: 'worksheet',
      coloringStyle: 'classic',
      standards: [],
      systemPrompt: '',
      systemPromptEdited: false,
      ...overrides,
    };
    const parentNode = currentPageId ? nodes.find((n) => n.id === currentPageId) : undefined;
    const pos = parentNode ? { x: parentNode.position.x + 380, y: parentNode.position.y } : { x: 0, y: 0 };
    setPages((ps) => ps.concat(newPage));
    setNodes((ns) => ns.concat(buildNode(newPage, pos)));
    setCurrentPageId(id);
    // apply default threshold
    void applyThreshold(id, newPage.bwThreshold || 200);
    return id;
  }

  // Branch prompt modal state
  const [branchingParentId, setBranchingParentId] = useState<string | null>(null);
  const [branchPrompt, setBranchPrompt] = useState<string>("");

  function branchFrom(parentId: string) {
    const parent = pages.find((p) => p.id === parentId);
    if (!parent) return;
    setBranchingParentId(parentId);
    setBranchPrompt(parent.prompt || "");
  }

  async function branchFromWithPrompt(parentId: string, prompt: string) {
    const parent = pages.find((p) => p.id === parentId);
    if (!parent) return;
    const id = crypto.randomUUID();
    const child: Page = { ...parent, id, title: `${parent.title} variant`, prompt };
    const parentNode = nodes.find((n) => n.id === parentId);
    const newPos = parentNode ? { x: parentNode.position.x, y: parentNode.position.y + 480 } : { x: 0, y: 480 };
    setPages((ps) => ps.concat(child));
    setNodes((ns) => ns.concat(buildNode(child, newPos)));
    setEdges((es) => es.concat({ id: crypto.randomUUID(), source: parentId, target: id }));
    setCurrentPageId(id);
    await generateChildFromParent(id, parent, prompt);
  }

  async function quickGenerate(pageId: string) {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const now = Date.now();
    if (now - lastQuickGenAtRef.current < 1200) { return; }
    lastQuickGenAtRef.current = now;
    const prompt = (page.prompt || "").trim();
    if (!prompt) { setBranchingParentId(pageId); setBranchPrompt(""); return; }
    await branchFromWithPrompt(pageId, prompt);
  }

  async function blobUrlToPngBase64(url: string): Promise<string> {
    // draw to canvas -> PNG dataURL -> strip prefix
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load failed')); img.src = url; });
    const max = 1650; // ~150dpi letter bound
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/png');
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  }

  async function generateChildFromParent(childId: string, parent: Page, prompt: string) {
    // If parent has an image, try transform with base; else generate new
    const baseUrl = parent.originalImageUrl || parent.imageUrl;
    // Draft child page object to avoid relying on asynchronous state updates
    const childDraft: Page = { ...parent, id: childId, prompt };
    if (baseUrl) {
      try {
        setGenerating(true);
        const baseB64 = await blobUrlToPngBase64(baseUrl);
        const instruction = buildInstructionPrompt(childDraft, prompt);
        const { transformImageWithPrompt } = await import('@/lib/nanoBanana');
        const rawUrl = await transformImageWithPrompt(baseB64, instruction);
        const fitted = await fitImageToPrintableArea(rawUrl, childDraft);
        setPagePatch(childId, { imageUrl: fitted, originalImageUrl: fitted });
        return;
      } catch (e) {
        console.warn('Transform failed; falling back to generate', e);
        pushToast('Transform failed. Falling back to generate.', 'error');
      } finally {
        setGenerating(false);
      }
    }
    await generateInto(childId, prompt, childDraft);
  }

  function buildInstructionPrompt(page: Page, userPrompt: string): string {
    const sys = (page.systemPrompt || '').trim();
    const user = (userPrompt || '').trim();
    return [sys, user].filter(Boolean).join(' ');
  }

  async function generateInto(pageId: string, prompt: string, pageOverride?: Page) {
    try {
      setGenerating(true);
      const page = pageOverride ?? pages.find(p => p.id === pageId)!;
      const instruction = buildInstructionPrompt(page, prompt);
      const { generateColoringBookImage } = await import("@/lib/nanoBanana");
      const rawUrl = await generateColoringBookImage(instruction);
      const fitted = await fitImageToPrintableArea(rawUrl, page);
      // Revoke previous object URLs to avoid leaks
      const prev = pages.find((p) => p.id === pageId);
      if (prev) {
        try {
          if (prev.originalImageUrl && prev.originalImageUrl.startsWith('blob:') && prev.originalImageUrl !== rawUrl) URL.revokeObjectURL(prev.originalImageUrl);
          if (prev.imageUrl && prev.imageUrl.startsWith('blob:') && prev.imageUrl !== rawUrl) URL.revokeObjectURL(prev.imageUrl);
        } catch {}
      }
      setPagePatch(pageId, { imageUrl: fitted, originalImageUrl: fitted });
    } catch (err) {
      pushToast((err as Error).message || 'Failed to generate image', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function applyInpainting(maskCanvas: HTMLCanvasElement, invert: boolean) {
    const page = currentPageId ? pages.find(p => p.id === currentPageId) : null;
    if (!page || !page.imageUrl) { pushToast('No base image to inpaint', 'error'); return; }
    try {
      setGenerating(true);
      // Base at the same size as overlay to ensure alignment
      const baseImg = new Image(); baseImg.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { baseImg.onload = () => res(); baseImg.onerror = () => rej(new Error('load base failed')); baseImg.src = page.imageUrl!; });
      const bc = document.createElement('canvas'); bc.width = maskCanvas.width; bc.height = maskCanvas.height;
      const bctx = bc.getContext('2d')!; bctx.fillStyle='#fff'; bctx.fillRect(0,0,bc.width,bc.height);
      // Fit base image to overlay canvas
      const scale = Math.min(bc.width / baseImg.width, bc.height / baseImg.height);
      const dw = Math.round(baseImg.width * scale), dh = Math.round(baseImg.height * scale);
      const dx = Math.floor((bc.width - dw) / 2), dy = Math.floor((bc.height - dh) / 2);
      bctx.drawImage(baseImg, dx, dy, dw, dh);
      const baseB64 = bc.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      // Mask PNG b64
      let maskData: ImageData | null = null;
      try { maskData = maskCanvas.getContext('2d')!.getImageData(0, 0, maskCanvas.width, maskCanvas.height); } catch {}
      if (!maskData) { pushToast('Empty mask', 'error'); return; }
      // Build BW mask: black background, white where overlay alpha > 0 (optionally invert)
      const mc = document.createElement('canvas'); mc.width = maskCanvas.width; mc.height = maskCanvas.height;
      const mctx = mc.getContext('2d')!; mctx.fillStyle = '#000'; mctx.fillRect(0,0,mc.width,mc.height);
      const src = maskData.data; const dst = mctx.getImageData(0,0,mc.width,mc.height); const dd = dst.data;
      for (let i=0;i<dd.length;i+=4) { const a = src[i+3]; const on = (a>0) ? 255 : 0; const v = invert ? 255-on : on; dd[i]=dd[i+1]=dd[i+2]=v; dd[i+3]=255; }
      mctx.putImageData(dst, 0, 0);
      const maskB64 = mc.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      const instruction = buildInstructionPrompt(page, page.prompt || '');
      const { editImageWithMaskGuidance } = await import('@/lib/nanoBanana');
      const rawUrl = await editImageWithMaskGuidance(baseB64, maskB64, instruction);
      const fitted = await fitImageToPrintableArea(rawUrl, page);
      setPagePatch(currentPageId!, { imageUrl: fitted, originalImageUrl: fitted });
      pushToast('Inpainting applied', 'success');
    } catch (e) {
      pushToast((e as Error).message || 'Inpainting failed', 'error');
    } finally {
      setGenerating(false);
      setShowInpaint(false);
    }
  }

  function deleteNode(pageId: string) {
    if (!confirm("Delete this node?")) return;
    // Find parents and children
    const incoming = edges.filter((e) => e.target === pageId);
    const outgoing = edges.filter((e) => e.source === pageId);
    const parentId = incoming[0]?.source || pages[0]?.id; // reattach to first parent, otherwise root
    const newEdges: Edge[] = edges
      .filter((e) => e.source !== pageId && e.target !== pageId) // remove edges touching deleted
      .concat(
        outgoing.map((childEdge) => ({
          id: crypto.randomUUID(),
          source: parentId!,
          target: childEdge.target,
        }))
      );
    setEdges(newEdges);
    setPages((ps) => ps.filter((p) => p.id !== pageId));
    setNodes((ns) => ns.filter((n) => n.id !== pageId));
    if (currentPageId === pageId) setCurrentPageId(parentId!);
  }

  // Drop & paste handlers (create nodes)
  const flowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer && (e.dataTransfer.dropEffect = "copy");
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          addPageFromImage(url, file.name);
        }
      }
      if (files.length) return;
      const urlText = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (urlText && /^https?:\/\//i.test(urlText)) {
        try {
          const resp = await fetch(urlText);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            const url = URL.createObjectURL(blob);
            addPageFromImage(url, "Dropped URL image");
          }
        } catch (err) {
          pushToast('Failed to fetch dropped URL', 'error');
        }
      }
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [flowRef.current]);

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      const imgItem = items.find((it) => it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          const url = URL.createObjectURL(file);
          addPageFromImage(url, "Pasted image");
          return;
        }
      }
      const text = e.clipboardData.getData("text/plain");
      if (text && /^https?:\/\//i.test(text)) {
        try {
          const resp = await fetch(text);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            const url = URL.createObjectURL(blob);
            addPageFromImage(url, "Pasted URL image");
          }
        } catch (err) {
          pushToast('Failed to fetch pasted URL', 'error');
        }
      }
    };
    window.addEventListener("paste", onPaste);
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const editing = !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable));
      // Cmd/Ctrl+Enter → quick generate on current node (not while typing)
      if (!editing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (currentPageId) quickGenerate(currentPageId);
        return;
      }
      // Delete key to delete selected/current node (not while typing)
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (currentPageId) deleteNode(currentPageId);
        return;
      }
      // Inpainting modal with "i" (not while typing)
      if (!editing && e.key.toLowerCase() === 'i' && currentPageId) {
        e.preventDefault();
        setShowInpaint(true);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener('keydown', onKeyDown); };
  }, []);

  // Simple BW threshold processing (apply to current page using originalImageUrl)
  async function applyThreshold(pageId: string, threshold: number) {
    const page = pages.find((p) => p.id === pageId);
    if (!page || !page.originalImageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    const src = page.originalImageUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Failed to load image"));
      img.src = src;
    });
    const maxW = 1024;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; // luminance
      const v = y >= threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    const url = canvas.toDataURL("image/png");
    // revoke previous processed URL if it was an object URL
    try {
      if (page.imageUrl && page.imageUrl.startsWith('blob:')) URL.revokeObjectURL(page.imageUrl);
    } catch {}
    setPagePatch(pageId, { imageUrl: url, bwThreshold: threshold });
  }

  // Export to PDF (letter)
  async function exportCurrentPageToPdf(page: Page) {
    if (!page.imageUrl) {
      alert("No image to export");
      return;
    }
    const pdf = new jsPDF({ orientation: page.orientation, unit: "in", format: "letter" });
    const pageW = page.orientation === "portrait" ? 8.5 : 11;
    const pageH = page.orientation === "portrait" ? 11 : 8.5;
    const m = page.marginInches;
    const imgW = pageW - 2 * m;
    const imgH = pageH - 2 * m;
    try {
      // Ensure we provide a dataURL that jsPDF can consume
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Failed to load image for export"));
        img.src = page.imageUrl as string;
      });
      const canvas = document.createElement("canvas");
      const dpr = 2;
      // Convert inches to px at 96DPI then scale by dpr
      const pxW = Math.round(imgW * 96);
      const pxH = Math.round(imgH * 96);
      canvas.width = pxW * dpr;
      canvas.height = pxH * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas context");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fit image contain inside target rect
      const scale = Math.min(pxW / img.width, pxH / img.height);
      const dw = Math.round(img.width * scale);
      const dh = Math.round(img.height * scale);
      const dx = Math.floor((pxW - dw) / 2);
      const dy = Math.floor((pxH - dh) / 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pxW, pxH);
      ctx.drawImage(img, dx, dy, dw, dh);
      const dataUrl = canvas.toDataURL("image/png");
      pdf.addImage(dataUrl, "PNG", m, m, imgW, imgH, undefined, "FAST");
      // Footer: standards (if any)
      const codes = (page.standards || []).join(', ');
      if (codes) {
        pdf.setFontSize(8);
        pdf.text(`Standards: ${codes}`, m, pageH - 0.3);
      }
      pdf.save("checkfu.pdf");
    } catch (err) {
      alert("Failed to add image to PDF");
    }
  }

  async function exportPagesToPdf(pagesToExport: Page[]) {
    if (!pagesToExport.length) return;
    const first = pagesToExport[0];
    const pdf = new jsPDF({ orientation: first.orientation, unit: 'in', format: 'letter' });
    for (let i = 0; i < pagesToExport.length; i++) {
      const page = pagesToExport[i];
      if (i > 0) pdf.addPage('letter', page.orientation);
      const pageW = page.orientation === 'portrait' ? 8.5 : 11;
      const pageH = page.orientation === 'portrait' ? 11 : 8.5;
      const m = page.marginInches;
      const imgW = pageW - 2 * m;
      const imgH = pageH - 2 * m;
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Failed to load image')); img.src = page.imageUrl || ''; });
        const canvas = document.createElement('canvas');
        const dpr = 2;
        const pxW = Math.round(imgW * 96), pxH = Math.round(imgH * 96);
        canvas.width = pxW * dpr; canvas.height = pxH * dpr;
        const ctx = canvas.getContext('2d'); if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const scale = Math.min(pxW / img.width, pxH / img.height);
        const dw = Math.round(img.width * scale); const dh = Math.round(img.height * scale);
        const dx = Math.floor((pxW - dw) / 2); const dy = Math.floor((pxH - dh) / 2);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pxW, pxH);
        ctx.drawImage(img, dx, dy, dw, dh);
        const dataUrl = canvas.toDataURL('image/png');
        pdf.addImage(dataUrl, 'PNG', m, m, imgW, imgH, undefined, 'FAST');
        const codes = (page.standards || []).join(', ');
        if (codes) { pdf.setFontSize(8); pdf.text(`Standards: ${codes}`, m, pageH - 0.3); }
      } catch (e) { /* skip page on error */ }
    }
    pdf.save('checkfu.pdf');
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="h-14 px-4 border-b bg-background flex items-center justify-between" role="toolbar" aria-label="Editor top bar">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Checkfu</span>
          <span className="text-sm text-muted-foreground">Editor</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm disabled:opacity-50"
            aria-label="Export"
            disabled={!pages.length}
            onClick={() => {
              const selected = nodes.filter(n => n.selected).map(n => pages.find(p => p.id === n.id)!).filter(Boolean) as Page[];
              const toExport = selected.length ? selected : (currentPage ? [currentPage] : []);
              if (!toExport.length) return;
              void exportPagesToPdf(toExport);
            }}
          >
            <span>Export</span>
            {nodes.filter(n => n.selected).length > 1 ? (
              <span className="px-1.5 h-5 min-w-[1.25rem] inline-flex items-center justify-center rounded bg-slate-200 text-slate-800 text-xs" aria-label="Selected count">
                {nodes.filter(n => n.selected).length}
              </span>
            ) : null}
          </button>
          <button className="px-3 py-1.5 rounded-md border text-sm" aria-label="Settings" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      {/* Main grid */}
      <div className="h-[calc(100vh-56px)] grid" style={{ gridTemplateColumns: "260px 1fr 320px" }}>
        {/* Left sidebar (Pages only) */}
        <aside className="border-r bg-background flex flex-col" role="complementary" aria-label="Left sidebar">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="text-sm font-medium">Pages</div>
              <button className="px-2 py-1 text-sm border rounded" onClick={() => {
                const id = crypto.randomUUID();
              const p: Page = { id, title: "New Page", orientation: "portrait", marginInches: 0.5, bwThreshold: 200, pageType: 'worksheet', coloringStyle: 'classic', standards: [], systemPrompt: '', systemPromptEdited: false };
              setPages((ps) => ps.concat(p));
              setCurrentPageId(id);
            }}>New</button>
          </div>
          <div className="p-3 overflow-auto grow" role="region" aria-label="Pages list">
            <ul className="space-y-1 text-sm">
              {pages.map((p) => {
                const selectedIds = new Set(nodes.filter(n => n.selected).map(n => n.id));
                const isSelected = selectedIds.has(p.id);
                const isActive = currentPageId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      id={`page-item-${p.id}`}
                      className={`w-full text-left px-2 py-1 rounded transition-colors hover:bg-slate-100 ${isSelected ? 'bg-slate-100' : ''} ${isActive ? 'ring-1 ring-blue-500 bg-blue-50 border-l-2 border-blue-500' : ''}`}
                      aria-pressed={isSelected}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={(e) => {
                        const isToggle = e.metaKey || e.ctrlKey;
                        setCurrentPageId(p.id);
                        if (isToggle) {
                          setNodes((ns) => ns.map(n => n.id === p.id ? { ...n, selected: !n.selected } : n));
                        } else {
                          setNodes((ns) => ns.map(n => ({ ...n, selected: n.id === p.id })));
                        }
                      }}
                    >
                      <span className="flex items-center justify-between">
                        <span className="truncate">{p.title}</span>
                        <span className="ml-2">
                          {isActive ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 align-middle">Active</span>
                          ) : isSelected ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 align-middle">Selected</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Graph */}
        <main className="bg-muted/20 overflow-hidden" aria-label="Graph editor">
          <div className="w-full h-full" ref={flowRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
              minZoom={0.05}
              maxZoom={2.5}
              translateExtent={[[-100000, -100000], [100000, 100000]]}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, n) => setCurrentPageId(n.id)}
              onConnect={(c: Connection) => setEdges((es) => addEdge(c, es))}
              noPanClassName="nopan"
              noDragClassName="nodrag"
              noWheelClassName="nowheel"
            >
              <Background />
              <Controls className="no-print" />
            </ReactFlow>
          </div>
        </main>

        {/* Inspector */}
        <aside className="border-l bg-background p-3 overflow-auto" aria-label="Inspector">
          {!currentPage ? (
            <div className="text-sm text-muted-foreground">
              Create your first page with the New button or drop/paste an image.
            </div>
          ) : (
          <div className="space-y-6 text-sm">
            {/* Page Type & Styles */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Type & Style</h3>
              <div className="mt-2 grid gap-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="pagetype" checked={(currentPage?.pageType || 'worksheet') === 'worksheet'} onChange={() => setPagePatch(currentPageId!, { pageType: 'worksheet' })} />
                    Worksheet
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="pagetype" checked={(currentPage?.pageType || 'worksheet') === 'coloring'} onChange={() => setPagePatch(currentPageId!, { pageType: 'coloring' })} />
                    Coloring Book
                  </label>
                </div>
                {(currentPage?.pageType || 'worksheet') === 'coloring' ? (
                  <div className="grid gap-1">
                    <label htmlFor="coloring-style">Style</label>
                    <select id="coloring-style" className="border rounded px-2 py-1" value={currentPage?.coloringStyle || 'classic'} onChange={(e) => setPagePatch(currentPageId!, { coloringStyle: e.target.value as any })}>
                      <option value="classic">Classic</option>
                      <option value="anime">Anime</option>
                      <option value="retro">Retro</option>
                      <option value="storybook">Storybook</option>
                    </select>
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Page</h3>
              <div className="mt-2 grid gap-2">
                <label htmlFor="page-title">Title</label>
                <input id="page-title" className="border rounded px-2 py-1" value={currentPage?.title || ""} onChange={(e) => setPagePatch(currentPageId!, { title: e.target.value })} />
                <label htmlFor="page-orientation">Orientation</label>
                <select id="page-orientation" className="border rounded px-2 py-1" value={currentPage?.orientation || "portrait"} onChange={(e) => setPagePatch(currentPageId!, { orientation: e.target.value as Orientation })}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
                <label htmlFor="page-margin">Margin (inches)</label>
                <input id="page-margin" type="number" min={0.25} max={1.5} step={0.25} className="border rounded px-2 py-1" value={currentPage?.marginInches ?? 0.5} onChange={(e) => setPagePatch(currentPageId!, { marginInches: parseFloat(e.target.value || "0.5") })} />
              </div>
            </section>

            {/* Standards (K only) for worksheets */}
            {(currentPage?.pageType || 'worksheet') === 'worksheet' ? (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground">Standards (K)</h3>
                <div className="mt-2 grid gap-2">
                  <input
                    type="text"
                    placeholder="Search (e.g., K.OA or count)"
                    className="border rounded px-2 py-1 text-sm"
                    onChange={(e) => {
                      const q = e.currentTarget.value.toLowerCase();
                      const all = standardsCatalog;
                      const filtered = q
                        ? all.filter(s => s.code.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
                        : all;
                      // Store filtered list temporarily via dataset on the select (no extra state)
                      const sel = document.getElementById('k-standards-select') as HTMLSelectElement | null;
                      if (sel) {
                        sel.dataset.filter = q;
                        // Force rerender by toggling a dummy value
                        sel.dispatchEvent(new Event('rebuild'));
                      }
                    }}
                  />
                  <StandardsMultiSelect
                    id="k-standards-select"
                    options={standardsCatalog}
                    value={currentPage?.standards || []}
                    onChange={(vals) => setPagePatch(currentPageId!, { standards: vals, systemPromptEdited: false })}
                  />
                  <div className="text-xs text-muted-foreground">Selected: {(currentPage?.standards || []).join(', ') || 'None'}</div>
                </div>
              </section>
            ) : null}

            {/* Prompts */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Prompts</h3>
              <div className="mt-2 grid gap-3 text-sm">
                <div className="grid gap-1">
                  <label htmlFor="sys-prompt">System Prompt</label>
                  <textarea id="sys-prompt" className="border rounded px-2 py-1 h-24" placeholder="Base instructions" value={currentPage?.systemPrompt || ''} onChange={(e) => setPagePatch(currentPageId!, { systemPrompt: e.target.value, systemPromptEdited: true })} />
                  <div>
                    <button className="px-2 py-1 border rounded" onClick={() => { setPagePatch(currentPageId!, { systemPrompt: computeSystemPrompt(currentPage!), systemPromptEdited: false }); }}>Refresh from selections</button>
                  </div>
                </div>
                <div className="grid gap-1">
                  <label htmlFor="gen-prompt">Prompt</label>
                  <textarea id="gen-prompt" className="border rounded px-2 py-1 h-24" placeholder="Extra instructions" value={currentPage?.prompt || ""} onChange={(e) => setPagePatch(currentPageId!, { prompt: e.target.value })} />
                </div>
                <button className="px-2 py-1 border rounded disabled:opacity-50 w-max" disabled={generating} onClick={async () => {
                  const prompt = (currentPage?.prompt || "").trim();
                  try {
                    setGenerating(true);
                    const { generateColoringBookImage } = await import("@/lib/nanoBanana");
                    const url = await generateColoringBookImage(buildInstructionPrompt(currentPage!, prompt));
                    setPagePatch(currentPageId!, { imageUrl: url, originalImageUrl: url });
                  } catch (err) {
                    pushToast((err as Error).message || 'Failed to generate image', 'error');
                  } finally {
                    setGenerating(false);
                  }
                }}>{generating ? "Generating…" : "Generate"}</button>
                {/* Inpainting moved to its own modal/section */}
              </div>
            </section>

            {/* Inpainting */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Inpainting</h3>
              <div className="mt-2 grid gap-2">
                <button className="px-2 py-1 border rounded disabled:opacity-50 w-max" disabled={!currentPage?.imageUrl} onClick={() => setShowInpaint(true)}>Inpaint…</button>
                <p className="text-xs text-muted-foreground">Paint a pink mask to transform selected areas. Press I to open quickly.</p>
              </div>
            </section>

            {/* Import */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Import</h3>
              <div className="mt-2 grid gap-2">
                <input type="file" accept="image/*" onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  if (f.size > 8 * 1024 * 1024) { pushToast('File too large (max 8 MB)', 'error'); return; }
                  const url = URL.createObjectURL(f);
                  const prev = pages.find(p => p.id === currentPageId!);
                  try {
                    if (prev?.originalImageUrl && prev.originalImageUrl.startsWith('blob:') && prev.originalImageUrl !== url) URL.revokeObjectURL(prev.originalImageUrl);
                    if (prev?.imageUrl && prev.imageUrl.startsWith('blob:') && prev.imageUrl !== url) URL.revokeObjectURL(prev.imageUrl);
                  } catch {}
                  setPagePatch(currentPageId!, { originalImageUrl: url, imageUrl: url });
                  void applyThreshold(currentPageId!, pages.find(p => p.id === currentPageId!)?.bwThreshold ?? 200);
                }} />
              </div>
            </section>
          </div>
          )}
        </aside>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-3 right-3 z-50 grid gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-3 py-2 rounded shadow text-sm ${t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-green-600 text-white' : 'bg-slate-800 text-white'}`}>{t.text}</div>
        ))}
      </div>

      {/* Inpainting modal */}
      {showInpaint && currentPage?.imageUrl ? (
        <InpaintModal
          imageUrl={currentPage.imageUrl}
          onCancel={() => setShowInpaint(false)}
          onApply={(maskCanvas, invert) => void applyInpainting(maskCanvas, invert)}
        />
      ) : null}

      {/* Settings modal */}
      {branchingParentId && (
        <div role="dialog" aria-modal className="fixed inset-0 bg-black/40 grid place-items-center">
          <div className="bg-white text-black rounded-md shadow-lg p-4 w-[520px] max-w-[92vw]">
            <h2 className="font-semibold mb-2">Refine by Prompt</h2>
            <p className="text-xs text-slate-600 mb-2">Describe how to change the current page. The model uses your System Prompt and this prompt together.</p>
            <textarea className="border rounded w-full h-32 px-2 py-1" autoFocus value={branchPrompt} onChange={(e) => setBranchPrompt(e.target.value)} />
            <div className="flex justify-end gap-2 mt-3">
              <button className="px-2 py-1 border rounded" onClick={() => { setBranchingParentId(null); setBranchPrompt(''); }}>Cancel</button>
              <button className="px-2 py-1 border rounded" onClick={() => { const pid = branchingParentId; const p = branchPrompt.trim(); setBranchingParentId(null); setBranchPrompt(''); if (pid && p) void branchFromWithPrompt(pid, p); }}>
                Create Variant
              </button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div role="dialog" aria-modal className="fixed inset-0 bg-black/40 grid place-items-center">
          <div className="bg-white text-black rounded-md shadow-lg p-4 w-[420px] max-w-[90vw]">
            <h2 className="font-semibold mb-3">Gemini API Key</h2>
            <p className="text-sm text-slate-600 mb-2">Stored in localStorage (use at your own risk).</p>
            <input id="apikey" className="border rounded px-2 py-1 w-full mb-2" placeholder="Enter CHECKFU_GEMINI_API_KEY" defaultValue={typeof window !== 'undefined' ? (localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '') : ''} />
            <div className="flex justify-end gap-2">
              <button className="px-2 py-1 border rounded" onClick={() => { localStorage.removeItem('CHECKFU_GEMINI_API_KEY'); setShowSettings(false); }}>Clear</button>
              <button className="px-2 py-1 border rounded" onClick={() => { const el = document.getElementById('apikey') as HTMLInputElement | null; if (el) localStorage.setItem('CHECKFU_GEMINI_API_KEY', el.value || ''); setShowSettings(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inpainting modal component: paints a pink translucent mask over the base image
function InpaintModal({
  imageUrl,
  onCancel,
  onApply,
}: {
  imageUrl?: string;
  onCancel: () => void;
  onApply: (maskCanvas: HTMLCanvasElement, invert: boolean) => void;
}) {
  const canvasRef = useReactRef<HTMLCanvasElement | null>(null);
  const maskRef = useReactRef<HTMLCanvasElement | null>(null);
  const isDownRef = useReactRef(false);
  const scaleRef = useReactRef(1);
  const imgRef = useReactRef<HTMLImageElement | null>(null);
  const [brushSize, setBrushSize] = useState(24);
  const [eraser, setEraser] = useState(false);
  const [invert, setInvert] = useState(false);

  // Setup canvas and draw base image
  useEffect(() => {
    const setup = async () => {
      if (!imageUrl) return;
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load failed')); img.src = imageUrl; });
      imgRef.current = img;
      const maxW = 820, maxH = 1060; // viewport for modal
      const scale = Math.min(1, Math.min(maxW / img.width, maxH / img.height));
      scaleRef.current = scale;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = canvasRef.current; const m = maskRef.current; if (!c || !m) return;
      c.width = w; c.height = h; m.width = w; m.height = h;
      const ctx = c.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0,0,w,h); ctx.drawImage(img, 0, 0, w, h);
      const mctx = m.getContext('2d'); if (!mctx) return; mctx.clearRect(0,0,w,h);
    };
    void setup();
  }, [imageUrl]);

  function drawAt(clientX: number, clientY: number) {
    const m = maskRef.current; const c = canvasRef.current; if (!m || !c) return;
    const rect = m.getBoundingClientRect();
    const x = clientX - rect.left; const y = clientY - rect.top;
    const ctx = m.getContext('2d'); if (!ctx) return;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(255, 20, 147, 0.45)';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, brushSize/2), 0, Math.PI*2); ctx.fill();
  }

  return (
    <div role="dialog" aria-modal className="fixed inset-0 bg-black/40 z-50 grid place-items-center">
      <div className="bg-white text-black rounded-md shadow-lg p-3 w-[960px] max-w-[95vw]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Inpainting</h2>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={eraser} onChange={(e)=>setEraser(e.currentTarget.checked)} />Eraser</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={invert} onChange={(e)=>setInvert(e.currentTarget.checked)} />Invert mask</label>
            <label className="flex items-center gap-1">Brush {brushSize}
              <input type="range" min={4} max={96} step={2} value={brushSize} onChange={(e)=>setBrushSize(parseInt(e.currentTarget.value,10))} />
            </label>
            <button className="px-2 py-1 border rounded" onClick={()=>{ const m = maskRef.current; if (!m) return; const mctx = m.getContext('2d'); if (!mctx) return; mctx.clearRect(0,0,m.width,m.height); }}>Clear</button>
          </div>
        </div>
        <div className="relative border bg-slate-50" style={{width:'fit-content'}}>
          <canvas ref={canvasRef} className="block" />
          <canvas
            ref={maskRef}
            className="absolute inset-0 block"
            onMouseDown={(e)=>{isDownRef.current=true; drawAt(e.clientX, e.clientY);}}
            onMouseMove={(e)=>{ if (isDownRef.current) drawAt(e.clientX, e.clientY); }}
            onMouseUp={()=>{isDownRef.current=false;}}
            onMouseLeave={()=>{isDownRef.current=false;}}
          />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button className="px-2 py-1 border rounded" onClick={onCancel}>Cancel</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ const m = maskRef.current; if (m) onApply(m, invert); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// Compact multi-select for K standards with simple search support
function StandardsMultiSelect({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: { code: string; description: string }[];
  value: string[];
  onChange: (vals: string[]) => void;
}) {
  const selectRef = useReactRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    const sel = selectRef.current; if (!sel) return;
    const onRebuild = () => {
      const q = (sel.dataset.filter || '').toLowerCase();
      const filtered = q
        ? options.filter(o => o.code.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q))
        : options;
      // Rebuild options list
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      for (const o of filtered) {
        const opt = document.createElement('option');
        opt.value = o.code;
        const desc = (o.description || '').length > 64 ? (o.description.slice(0, 61) + '…') : (o.description || '');
        opt.textContent = `${o.code} — ${desc}`;
        opt.selected = value.includes(o.code);
        sel.appendChild(opt);
      }
    };
    onRebuild();
    sel.addEventListener('rebuild', onRebuild as any);
    return () => sel.removeEventListener('rebuild', onRebuild as any);
  }, [options, value]);

  return (
    <select
      id={id}
      ref={selectRef}
      multiple
      size={8}
      className="border rounded px-2 py-1 text-sm h-[172px] overflow-auto"
      onChange={(e) => {
        const vals = Array.from(e.currentTarget.selectedOptions).map(o => o.value);
        onChange(vals);
      }}
    />
  );
}
