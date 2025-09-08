"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  coloringStyle?: 'classic' | 'anime' | 'retro';
  standards?: string[];
  generating?: boolean;
  status?: string;
};

// EditorPage: Node-based generator for printable K–1 pages.
// - Graph of Page nodes (React Flow)
// - Each Page is a single 8.5×11 image with margins
// - Branching uses the parent image + prompt to create a child variant
// - Inspector manages Page Type, K standards, style, System Prompt + Prompt
export default function Editor() {
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
  const [needsApiKey, setNeedsApiKey] = useState(false);
  // Keep current page visible in the sidebar
  useEffect(() => {
    if (!currentPageId) return;
    const el = document.getElementById(`page-item-${currentPageId}`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPageId]);
  // Highlight API key button if missing key
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        setNeedsApiKey(!localStorage.getItem('CHECKFU_GEMINI_API_KEY'));
      }
    } catch {}
  }, [showSettings]);
  // Inpainting disabled for now

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
        loading: !!p.generating,
        loadingText: p.status,
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

  const onNodesChange = (changes: NodeChange<PageRFNode>[]) => {
    const removedIds = new Set(
      changes
        .filter((c): c is { type: 'remove'; id: string } => (c as unknown as { type: string }).type === 'remove')
        .map((c) => c.id)
        .filter(Boolean)
    );
    setNodes((ns) => applyNodeChanges<PageRFNode>(changes, ns));
    if (removedIds.size) {
      setPages((ps) => {
        const filtered = ps.filter((p) => !removedIds.has(p.id));
        setCurrentPageId((prev) => (prev && removedIds.has(prev) ? filtered[0]?.id ?? null : prev));
        return filtered;
      });
      setEdges((es) => es.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)));
    }
  };

  function deleteNodes(ids: string[]) {
    if (!ids.length) return;
    setEdges((es) => es.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)));
    setPages((ps) => ps.filter((p) => !ids.includes(p.id)));
    setNodes((ns) => ns.filter((n) => !ids.includes(n.id)));
    setCurrentPageId((prev) => (prev && ids.includes(prev) ? (pages.find((p) => !ids.includes(p.id))?.id ?? null) : prev));
  }

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
    // aspect ratio target (not used with contain placement)

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
    const bleed = 0; // avoid cropping into heavy border lines
    if (sw < img.width || sh < img.height) {
      sx = Math.min(Math.max(0, sx + bleed), img.width - 1);
      sy = Math.min(Math.max(0, sy + bleed), img.height - 1);
      sw = Math.max(1, Math.min(img.width - sx, sw - bleed * 2));
      sh = Math.max(1, Math.min(img.height - sy, sh - bleed * 2));
    }

    // Now place the trimmed rect using CONTAIN (no further cropping) with a small inner padding.
    const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
    const ctx = c.getContext('2d'); if (!ctx) return url;
    ctx.imageSmoothingQuality = 'high';
    // breathing room inside printable area so content never touches the margins
    const pad = Math.max(6, Math.round(Math.min(pxW, pxH) * 0.02));
    const availW = Math.max(1, pxW - 2 * pad);
    const availH = Math.max(1, pxH - 2 * pad);
    const scale = Math.min(availW / Math.max(1, sw), availH / Math.max(1, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const dx = pad + Math.floor((availW - dw) / 2);
    const dy = pad + Math.floor((availH - dh) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    return c.toDataURL('image/png');
  }

  // Build an explicit, print oriented System Prompt from selections
  function computeSystemPrompt(p: Page): string {
    const isWorksheet = (p.pageType || "worksheet") === "worksheet";

    // Orientation and margins for letter
    const letter = p.orientation === "landscape" ? "11×8.5 landscape" : "8.5×11 portrait";
    const margin = (p.marginInches ?? 0.5).toFixed(2);

    // Shared print rules for Nano Banana
    const printRules = [
      `Print target: US Letter ${letter}. Keep all content inside ${margin} inch margins.`,
      "Output: one black and white line art image for print.",
      "Style: thick uniform outlines, high contrast, large closed shapes. No gray tones. No shading. No halftones. No photo textures.",
      "Background: white only.",
      "Exclusions: no frames, borders, watermarks, signatures, logos, or captions.",
      "Aspect: do not change the provided orientation.",
      "If a mask is provided, change only masked regions and keep all unmasked regions identical."
    ].join(" ");

    if (isWorksheet) {
      // Standards summary
      const selected = p.standards || [];
      const codes = selected.join(", ");
      const lookup = new Map(standardsCatalog.map(s => [s.code, s.description] as const));
      const descs = selected
        .map(code => {
          const d = lookup.get(code) || "";
          return d ? `${code}: ${d}` : "";
        })
        .filter(Boolean);

      const ccSummary = codes
        ? `Common Core Kindergarten focus: ${codes}. `
        : "Common Core Kindergarten math practices. ";
      const ccDetail = descs.length ? `Target standards: ${descs.join("; ")}. ` : "";

      // Worksheet specific guidance for K
      const wk = [
        "Purpose: a solvable worksheet that a kindergarten student can complete independently.",
        "1) Provide exactly one short instruction line at the top in simple English.",
        "2) Use concrete visual math tools such as ten frames, number lines, dot cards, or simple manipulatives.",
        "3) Quantities never exceed 10. Prefer numerals for labels and examples.",
        "4) Use three to six tasks or one main task with three to six parts.",
        "5) Provide large answer areas about 1.25 inch squares or lines with generous white space.",
        "6) Layout flows from left to right and then top to bottom. Keep balance and clarity.",
        "7) High contrast line art suitable for printing."
      ].join(" ");

      const wkNegatives = [
        "Do not add titles or headers.",
        "Do not add decorative frames.",
        "Do not place elements on or past the margins.",
        "Do not include stickers, emojis, photographs, or gray fills."
      ].join(" ");

      return `${ccSummary}${ccDetail}${wk} ${printRules} ${wkNegatives}`.trim();
    }

    // Coloring page styles
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
      "4) High contrast line art that prints cleanly."
    ].join(" ");

    const colNegatives = [
      "Do not use gray tones or shading.",
      "Do not use fine hatching or dense patterns.",
      "Do not add borders, titles, captions, watermarks, or logos.",
      "Do not place elements on or past the margins."
    ].join(" ");

    return `${styleText} ${col} ${printRules} ${colNegatives}`.trim();
  }

  // Auto-refresh system prompt when selections change unless edited
  useEffect(() => {
    setPages((ps) => ps.map((p) => {
      if (p.id !== currentPageId) return p;
      if (p.systemPromptEdited) return p;
      const sys = computeSystemPrompt(p);
      return { ...p, systemPrompt: sys };
    }));
  }, [currentPage?.pageType, currentPage?.coloringStyle, currentPage?.orientation, currentPage?.marginInches, (currentPage?.standards || []).join('|')]);

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
      pageType: 'coloring',
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
    const child: Page = { ...parent, id, title: `${parent.title} variant`, prompt, generating: true, status: 'Transforming…' };
    const parentNode = nodes.find((n) => n.id === parentId);
    const newPos = parentNode ? { x: parentNode.position.x, y: parentNode.position.y + 480 } : { x: 0, y: 480 };
    setPages((ps) => ps.concat(child));
    setNodes((ns) => {
      // unselect all existing nodes and add the new one as selected
      const cleared = ns.map((n) => ({ ...n, selected: false }));
      const newNode = buildNode(child, newPos);
      return cleared.concat({ ...newNode, selected: true });
    });
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
    setPagePatch(childId, { generating: true, status: 'Transforming…' });
    if (baseUrl) {
      try {
        setGenerating(true);
        const baseB64 = await blobUrlToPngBase64(baseUrl);
        const instruction = buildInstructionPrompt(childDraft, prompt);
        const { transformImageWithPrompt } = await import('@/lib/nanoBanana');
        const rawUrl = await transformImageWithPrompt(baseB64, instruction);
        const fitted = await fitImageToPrintableArea(rawUrl, childDraft);
        setPagePatch(childId, { imageUrl: fitted, originalImageUrl: fitted, generating: false, status: '' });
        return;
      } catch (e) {
        console.warn('Transform failed; falling back to generate', e);
        pushToast('Transform failed. Falling back to generate.', 'error');
      } finally {
        setGenerating(false);
      }
    }
    setPagePatch(childId, { generating: true, status: 'Generating…' });
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
      setPagePatch(pageId, { generating: true, status: 'Generating…' });
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
        } catch { }
      }
      setPagePatch(pageId, { imageUrl: fitted, originalImageUrl: fitted, generating: false, status: '' });
    } catch (err) {
      pushToast((err as Error).message || 'Failed to generate image', 'error');
      setPagePatch(pageId, { generating: false, status: '' });
    } finally {
      setGenerating(false);
    }
  }

  // Inpainting disabled for now

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
      // Delete key: delete selected nodes or current node (not while typing)
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const selected = nodes.filter((n) => n.selected).map((n) => n.id);
        if (selected.length > 1) {
          // batch delete
          deleteNodes(selected);
        } else if (currentPageId) {
          deleteNode(currentPageId);
        }
        return;
      }
      // Inpainting disabled
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
    } catch { }
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
      <header className="h-14 px-4 border-b border-slate-200 bg-sky-50/60 backdrop-blur flex items-center justify-between" role="toolbar" aria-label="Editor top bar">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Checkfu</span>
          <span className="text-sm text-slate-700">personalized learning materials for kindergarteners</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm disabled:opacity-50"
            aria-label="Export to PDF"
            disabled={!pages.length}
            onClick={() => {
              const selected = nodes.filter(n => n.selected).map(n => pages.find(p => p.id === n.id)!).filter(Boolean) as Page[];
              const toExport = selected.length ? selected : (currentPage ? [currentPage] : []);
              if (!toExport.length) return;
              void exportPagesToPdf(toExport);
            }}
          >
            <span>Export to PDF</span>
            {nodes.filter(n => n.selected).length > 1 ? (
              <span className="px-1.5 h-5 min-w-[1.25rem] inline-flex items-center justify-center rounded bg-blue-100 text-blue-800 text-xs" aria-label="Selected count">
                {nodes.filter(n => n.selected).length}
              </span>
            ) : null}
          </button>
          <button
            className={`px-3 py-1.5 rounded-md border text-sm inline-flex items-center gap-2 ${needsApiKey ? 'border-amber-400 bg-amber-50 text-amber-800' : ''}`}
            aria-label="Settings"
            title={needsApiKey ? 'Add your Gemini API key to generate images' : 'API Key'}
            onClick={() => setShowSettings(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 2.4l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .63.37 1.2.95 1.45.33.14.68.27 1.05.37" />
            </svg>
            {needsApiKey ? 'Add API Key' : 'API Key'}
          </button>
        </div>
      </header>

      {/* Main grid */}
      <div className="h-[calc(100vh-56px)] grid" style={{ gridTemplateColumns: "260px 1fr 320px" }}>
        {/* Left sidebar (Pages only) */}
        <aside className="border-r border-slate-200 bg-sky-50/30 flex flex-col" role="complementary" aria-label="Left sidebar">
          <div className="p-2 border-b border-sky-100 flex items-center justify-between">
            <div className="text-sm font-medium">Pages</div>
              <button className="px-2 py-1 text-sm border rounded inline-flex items-center gap-1" title="Create a new page" onClick={() => {
                const id = crypto.randomUUID();
              const p: Page = { id, title: "New Page", orientation: "portrait", marginInches: 0.5, bwThreshold: 200, pageType: 'coloring', coloringStyle: 'classic', standards: [], systemPrompt: '', systemPromptEdited: false };
              setPages((ps) => ps.concat(p));
              setCurrentPageId(id);
            }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New
              </button>
          </div>
          <div className="p-3 overflow-auto grow" role="region" aria-label="Pages list">
            {pages.length === 0 ? (
              <div className="h-full grid place-items-center text-slate-500">
                <div className="text-center max-w-[220px]">
                  <div className="mx-auto mb-2 h-10 w-10 rounded-full border border-dashed border-slate-300 grid place-items-center text-slate-400">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="4" width="18" height="14" rx="2" ry="2"></rect>
                      <path d="M8 22h8"></path>
                    </svg>
                  </div>
                  <div className="text-sm">No pages yet</div>
                  <div className="text-xs mt-1">Click <span className="font-medium">New</span> or drop/paste an image to start.</div>
                </div>
              </div>
            ) : (
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
        <aside className="border-l border-slate-200 bg-sky-50/30 p-3 overflow-auto" aria-label="Inspector">
          {!currentPage ? (
            <div className="text-sm text-muted-foreground">
              Create your first page with the New button or drop/paste an image.
            </div>
          ) : (
            <div className="space-y-6 text-sm">
              {/* Page Type & Styles */}
              <section>
                <h3 className="text-sm font-semibold text-slate-700">Type & Style</h3>
                <div className="mt-2 grid gap-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="pagetype" checked={(currentPage?.pageType || 'coloring') === 'coloring'} onChange={() => setPagePatch(currentPageId!, { pageType: 'coloring' })} />
                    Coloring Book
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="radio" name="pagetype" checked={(currentPage?.pageType || 'coloring') === 'worksheet'} onChange={() => setPagePatch(currentPageId!, { pageType: 'worksheet' })} />
                    Worksheet (beta)
                  </label>
                </div>
                  {(currentPage?.pageType || 'worksheet') === 'coloring' ? (
                    <div className="grid gap-1">
                      <label htmlFor="coloring-style">Style</label>
                      <select id="coloring-style" className="border rounded px-2 py-1" value={currentPage?.coloringStyle || 'classic'} onChange={(e) => setPagePatch(currentPageId!, { coloringStyle: e.target.value as any })}>
                        <option value="classic">Classic</option>
                        <option value="anime">Anime</option>
                        <option value="retro">Retro</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-700">Page</h3>
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
                  <h3 className="text-sm font-semibold text-slate-700">Standards (K)</h3>
                  <div className="mt-2 grid gap-2">
                    <input
                      type="text"
                      placeholder="Search (e.g., K.OA or count)"
                      className="border rounded px-2 py-1 text-sm"
                      onChange={(e) => {
                        const q = e.currentTarget.value.toLowerCase();
                        const sel = document.getElementById('k-standards-select') as HTMLSelectElement | null;
                        if (sel) {
                          sel.dataset.filter = q;
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
              <h3 className="text-sm font-semibold text-slate-700">Prompts</h3>
                <div className="mt-2 grid gap-3 text-sm">
                  <div className="grid gap-1">
                    <label htmlFor="sys-prompt">System Prompt</label>
                    <textarea id="sys-prompt" className="border rounded px-2 py-1 h-24" placeholder="Base instructions" value={currentPage?.systemPrompt || ''} onChange={(e) => setPagePatch(currentPageId!, { systemPrompt: e.target.value, systemPromptEdited: true })} />
                  
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor="gen-prompt">Prompt</label>
                    <textarea id="gen-prompt" className="border rounded px-2 py-1 h-24" placeholder="Extra instructions" value={currentPage?.prompt || ""} onChange={(e) => setPagePatch(currentPageId!, { prompt: e.target.value })} />
                  </div>
                  <button className="px-2 py-1 border rounded disabled:opacity-50 w-max" disabled={generating} onClick={async () => {
                    const promptText = (currentPage?.prompt || "").trim();
                    await generateInto(currentPageId!, promptText);
                  }}>{generating ? "Generating…" : "Generate"}</button>
                  {/* Inpainting moved to its own modal/section */}
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
                    } catch { }
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

      {/* Inpainting disabled */}

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
            <input id="apikey" className="border rounded px-2 py-1 w-full mb-2" placeholder="GEMINI_API_KEY" defaultValue={typeof window !== 'undefined' ? (localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '') : ''} />
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

// Inpainting modal component disabled for now

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
