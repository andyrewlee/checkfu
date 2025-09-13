"use client";

/**
 * Editor
 * Node-based generator for printable K–1 pages
 * - Graph of Page nodes rendered via React Flow
 * - Each Page is one US Letter page with a single image (no enforced margins)
 * - Branching creates child variants from a parent image plus a prompt
 * - Inspector manages Page Type, Standards, Style, System Prompt, and Prompt
 *
 * Undo/Redo instrumentation (high-level):
 * - Domain state (pages, children, edges, nodePositions) lives in the
 *   Zustand store wrapped by zundo; Undo/Redo operate on that.
 * - UI-only state (spinners, status, current page, text selection) is written
 *   using writeUI(...) from the store, which pauses temporal so these writes do
 *   NOT clear Redo or create noisy history entries.
 * - Generation is staged in memory and applied as a single domain commit; this
 *   ensures one clean history snapshot per user intent.
 * - Dragging records a single nodePositions snapshot when the drag ends.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  useAuth,
  useClerk,
  SignedIn,
  SignedOut,
  UserButton,
  SignInButton,
} from "@clerk/nextjs";
import { useSubscription } from "@clerk/nextjs/experimental";
// Text generation now uses server-side AI SDK via Convex action
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  useNodesState,
  type NodeChange,
} from "@xyflow/react";
import type {
  Edge as RFEdge,
  Node as RFNode,
  Connection,
  NodeTypes,
} from "@xyflow/react";
import { jsPDF } from "jspdf";
import PageNode, { type PageNodeData } from "@/components/nodes/PageNode";
import { newId } from "@/lib/ids";
import { revokeIfBlob } from "@/lib/url";
import { useMutation, useQuery, useAction } from "convex/react";
import { api as generatedApi } from "@/convex/_generated/api";
// Layers panel removed from Inspector to focus on a single selection
import {
  useActions,
  usePages,
  useCurrentPageId,
  useCurrentPage,
  useEditorStore,
  writeUI,
  useEdges as useGraphEdges,
  undo,
  redo,
} from "@/store/useEditorStore";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Types now sourced from global editor store
import type {
  Page,
  TextChild,
  ImageChild,
  Orientation,
} from "@/store/useEditorStore";
import {
  fitImageToPrintableArea,
  fitImageToRect,
  thresholdToDataUrl,
} from "@/lib/image/bitmap";
import { flattenPageToPng, addPageToJsPdf } from "@/lib/pdf";
import {
  computeSystemPrompt,
  buildInstruction as buildInstructionPure,
} from "@/lib/prompts";
import { useDropAndPasteImport } from "@/hooks/useDropAndPasteImport";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

/**
 * Module: Constants and narrow utilities
 */

const DEFAULT_THRESHOLD = 200;

export const nodeTypes: NodeTypes = { page: PageNode };

// React Flow stable constants to avoid prop identity churn
const RF_FIT_VIEW_OPTIONS = { padding: 0.22 } as const;
const RF_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.72 } as const;
const RF_TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [-100000, -100000],
  [100000, 100000],
];

// image helpers moved to lib/image/bitmap

/**
 * Module: Image utilities — fit, trim, threshold, base64
 */

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

function useAutoScrollIntoView(id: string | null) {
  useEffect(() => {
    if (!id) return;
    const el = document.getElementById(`page-item-${id}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [id]);
}

// BYO API key (client) removed — all generation runs server-side via Convex actions.

export default function Editor() {
  // Client gating: require sign-in + active subscription (server still enforces)
  const { isSignedIn } = useAuth();
  const { openSignIn, openUserProfile } = useClerk();
  const {
    data: subscription,
    isLoading: subLoading,
    error: subError,
  } = useSubscription();

  const status = (subscription as any)?.status as string | undefined;
  const hasActivePlan = status === "active" || status === "trialing";

  const ensurePaid = useCallback(async () => {
    if (!isSignedIn) {
      openSignIn?.({});
      return false;
    }
    if (subLoading) return false;
    if (subError || !hasActivePlan) {
      openUserProfile?.();
      return false;
    }
    return true;
  }, [
    isSignedIn,
    subLoading,
    subError,
    hasActivePlan,
    openSignIn,
    openUserProfile,
  ]);
  const pages = usePages();
  const currentPageId = useCurrentPageId();
  const currentPage = useCurrentPage();
  const actions = useActions();
  const nodePositions = useEditorStore((s) => s.nodePositions);
  type PageRFNode = RFNode<PageNodeData, "page">;
  const [nodes, setNodes] = useNodesState<PageRFNode>([]);
  const graphEdges = useGraphEdges();
  const rfEdges: RFEdge[] = graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  // Settings modal removed (API key no longer needed client-side)
  // No canvas suppression/one-shot removal state; keep data flow simple
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
  // Per-page operation tokens to cancel stale async writes (model outputs)
  // after an Undo/Redo or a new operation. See generateInto / text/image updates
  // where we call beginPageOp() and check isPageOpCurrent() before applying.
  const pageOpSeqRef = useRef<Record<string, number>>({});
  // Begin a logical async operation on a page. We use a token (sequence number)
  // to ignore stale async results that complete after an Undo/Redo or when a
  // newer op supersedes the old one.
  const beginPageOp = useCallback((id: string) => {
    const seq = (pageOpSeqRef.current[id] || 0) + 1;
    pageOpSeqRef.current[id] = seq;
    return seq;
  }, []);
  const isPageOpCurrent = useCallback(
    (id: string, seq: number) => pageOpSeqRef.current[id] === seq,
    [],
  );
  // Per-node quick prompts for Text/Image inspectors
  const [nodePrompts, setNodePrompts] = useState<Record<string, string>>({});
  // Per-node preset selection (None by default)
  const [nodePresets, setNodePresets] = useState<Record<string, string>>({});
  const lastQuickGenAtRef = useRef<number>(0);
  const generatingAny = pages.some((p) => p.generating);
  // All AI calls are server-side; no client API key needed.
  // Top-bar UI feedback states
  const [undoFlash, setUndoFlash] = useState(false);
  const [redoFlash, setRedoFlash] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  // Editor now always mounts under <SignedIn>. No conditional early returns.
  // Keep current page visible in the sidebar
  useAutoScrollIntoView(currentPageId);

  // Convex bindings (cast to any until `npx convex dev` regenerates types)
  const apiAny = generatedApi as any;
  const getOrCreateMyProject = useMutation(
    apiAny.projects?.getOrCreateMyProject ??
      apiAny.explore?.getOrCreateMyProject,
  );
  const createPageMutation = useMutation(
    apiAny.pages?.createPage ?? apiAny.explore?.createPage,
  );
  const updatePageMetaMutation = useMutation(
    apiAny.pages?.updatePageMeta ?? apiAny.explore?.updatePageMeta,
  );
  const addTextNodeMutation = useMutation(
    apiAny.nodes?.addTextNode ?? apiAny.explore?.addTextNode,
  );
  const addImageNodeMutation = useMutation(
    apiAny.nodes?.addImageNode ?? apiAny.explore?.addImageNode,
  );
  const updateTextNodeMutation = useMutation(
    apiAny.nodes?.updateTextNode ?? apiAny.explore?.updateTextNode,
  );
  const updateImageNodeMutation = useMutation(
    apiAny.nodes?.updateImageNode ?? apiAny.explore?.updateImageNode,
  );
  const deletePageMutation = useMutation(
    apiAny.pages?.deletePageDeep ?? apiAny.explore?.deletePageDeep,
  );
  const deleteChildNodeMutation = useMutation(
    apiAny.nodes?.deleteNode ?? apiAny.explore?.deleteNode,
  );
  const branchPageMutation = useMutation(
    apiAny.pages?.branchPage ?? apiAny.explore?.branchPage,
  );
  // Server-side AI actions (Convex). All generation routes through these.
  const aiGenerateImage = useAction(apiAny.ai?.generateImage);
  const aiGenerateText = useAction(apiAny.ai?.generateTextLabel);
  const setPageRenderFile = useMutation(apiAny.pages?.setRenderFile);

  const [projectId, setProjectId] = useState<string | null>(null);
  const isLocalPageId = (id: string) =>
    id.startsWith("p_") || id.startsWith("tmp");
  const isLocalNodeId = (id: string) =>
    id.startsWith("t_") || id.startsWith("img") || id.startsWith("imgph");
  // Fetch full project once we have an id
  const projectFull = useQuery(
    apiAny.projects?.getProjectFull ?? apiAny.explore?.getProjectFull,
    projectId ? { projectId } : "skip",
  ) as any;

  // Collect fileIds in this project to fetch display URLs (once)
  const projectFileIds = useMemo(() => {
    if (!projectFull) return [] as string[];
    const set = new Set<string>();
    for (const p of projectFull.pages || []) {
      if (p.renderFileId) set.add(p.renderFileId as string);
      const nodes: any[] = projectFull.nodesByPage?.[p._id] || [];
      for (const n of nodes)
        if (n.kind === "image" && n.fileId) set.add(n.fileId as string);
    }
    return Array.from(set);
  }, [projectFull]);
  const fileUrls = useQuery(
    apiAny.files?.getFileUrls ?? apiAny.explore?.getFileUrls,
    projectFileIds.length ? { fileIds: projectFileIds } : "skip",
  ) as any;

  // On mount for signed-in users: get or create their project
  useEffect(() => {
    (async () => {
      if (!isSignedIn) return;
      if (projectId) return;
      try {
        const id = await getOrCreateMyProject({});
        setProjectId(id as string);
      } catch (e) {
        console.warn("getOrCreateMyProject failed", e);
      }
    })();
  }, [isSignedIn, projectId, getOrCreateMyProject]);

  // Hydrate store from server the first time
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!projectFull || hydratedRef.current) return;
    const f = projectFull as {
      project: any;
      pages: any[];
      edges: any[];
      nodesByPage: Record<string, any[]>;
    } | null;
    if (!f) return;
    // Simple hydration: add pages and children into store
    const posPatch: Record<string, { x: number; y: number }> = {};
    for (const p of f.pages) {
      const pageIdStr = p._id as string;
      const pageTitle = p.title as string;
      const pageOrientation = (p.orientation as any) || "portrait";
      (actions as any).addEmptyPage?.({
        id: pageIdStr,
        title: pageTitle,
        orientation: pageOrientation,
        imageUrl:
          (p.renderFileId &&
            (fileUrls as any)?.urls?.[p.renderFileId as string]) ||
          undefined,
      });
      // Capture persisted graph position
      if (typeof p.x === "number" && typeof p.y === "number") {
        posPatch[pageIdStr] = { x: Math.round(p.x), y: Math.round(p.y) };
      }
      const nodes = (f.nodesByPage[pageIdStr] || []) as any[];
      const children = nodes.map((n) => {
        if (n.kind === "text") {
          return {
            id: n._id as string,
            type: "text",
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            angle: n.rotation || 0,
            visible: true,
            locked: false,
            z: n.z || 0,
            text: n.content || "",
            fontFamily: n.style?.fontFamily || "Inter",
            fontSize: n.style?.fontSize || 24,
            fontWeight: n.style?.bold ? "bold" : "normal",
            italic: !!n.style?.italic,
            align: (n.style?.align as any) || "left",
          } as TextChild;
        } else {
          const fid = (n as any).fileId as string | undefined;
          const url = fid ? fileUrls?.urls?.[fid] : undefined;
          return {
            id: n._id as string,
            type: "image",
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            angle: n.rotation || 0,
            visible: true,
            locked: false,
            z: n.z || 0,
            src: url,
            placeholder: !url,
            fileId: fid,
            crop: null,
          } as ImageChild;
        }
      });
      (actions as any).replaceChildren?.(pageIdStr, children);
    }
    if (Object.keys(posPatch).length) {
      (actions as any).setNodePositions?.(posPatch);
    }
    // Load edges (use a dedicated setter so ids match DB ids)
    const edgeList = (f.edges || []).map((e: any) => ({
      id: e._id as string,
      source: e.srcPageId as string,
      target: e.dstPageId as string,
    }));
    if ((actions as any).setEdges) (actions as any).setEdges(edgeList);
    hydratedRef.current = true;
  }, [projectFull, fileUrls, actions]);

  // When file URLs arrive after initial hydration, patch image children that
  // have a fileId but are still placeholders (or missing src) with the URL.
  useEffect(() => {
    const map = (fileUrls as any)?.urls as Record<string, string> | undefined;
    if (!map) return;
    const state = useEditorStore.getState();
    const ids = state.order;
    ids.forEach((pid) => {
      const page = state.pages[pid];
      if (!page) return;
      // Patch page background if render file URL is available and src missing
      const pageFull = (projectFull as any)?.pages?.find(
        (pp: any) => String(pp._id) === pid,
      );
      const pageRenderId = pageFull?.renderFileId as string | undefined;
      if (pageRenderId) {
        const url = map[pageRenderId];
        if (url && (!page.imageUrl || page.imageUrl.startsWith("blob:"))) {
          (actions as any).patchPage?.(pid, {
            imageUrl: url,
            originalImageUrl: url,
          });
        }
      }
      let changed = false;
      const next = (page.children || []).map((c) => {
        if (c.type === "image" && (c as any).fileId) {
          const fid = (c as any).fileId as string;
          const url = map[fid];
          if (url && ((c as any).placeholder || !(c as any).src)) {
            changed = true;
            return {
              ...(c as any),
              src: url,
              placeholder: false,
            } as ImageChild;
          }
        }
        return c;
      });
      if (changed) (actions as any).replaceChildren?.(pid, next);
    });
  }, [fileUrls, actions, projectFull]);

  // Debounced server updates for node changes
  const nodeUpdateTimersRef = useRef<Record<string, number>>({});
  const scheduleNodeUpdate = useCallback(
    (child: TextChild | ImageChild) => {
      const id = child.id;
      if (!id) return;
      if (!isSignedIn || isLocalNodeId(id)) return;
      const prev = nodeUpdateTimersRef.current[id];
      if (prev) clearTimeout(prev);
      nodeUpdateTimersRef.current[id] = window.setTimeout(async () => {
        try {
          if (child.type === "text") {
            await updateTextNodeMutation({
              nodeId: id,
              x: child.x,
              y: child.y,
              width: child.width,
              height: child.height,
              rotation: child.angle || 0,
              z: child.z || 0,
              content: child.text,
              style: {
                fontFamily: child.fontFamily,
                fontSize: child.fontSize,
                bold: child.fontWeight === "bold",
                italic: !!child.italic,
                align: child.align || "left",
              },
            });
          } else {
            await updateImageNodeMutation({
              nodeId: id,
              x: child.x,
              y: child.y,
              width: child.width,
              height: child.height,
              rotation: child.angle || 0,
              z: child.z || 0,
            });
          }
        } catch (e) {
          console.warn("node update failed", e);
        }
      }, 250);
    },
    [updateTextNodeMutation, updateImageNodeMutation, isSignedIn],
  );

  // Debounced page meta updates (title/orientation/position)
  const pageUpdateTimersRef = useRef<Record<string, number>>({});
  const pendingPagePatchRef = useRef<Record<string, Partial<Page>>>({});
  const schedulePageUpdate = useCallback(
    (pageId: string, patch: Partial<Page>) => {
      if (!isSignedIn) return;
      if (pageId.startsWith("p_") || pageId.startsWith("tmp")) return;
      pendingPagePatchRef.current[pageId] = {
        ...(pendingPagePatchRef.current[pageId] || {}),
        ...patch,
      };
      const prev = pageUpdateTimersRef.current[pageId];
      if (prev) clearTimeout(prev);
      pageUpdateTimersRef.current[pageId] = window.setTimeout(async () => {
        const p = pendingPagePatchRef.current[pageId] || {};
        try {
          await updatePageMetaMutation({
            pageId,
            title: typeof p.title === "string" ? p.title : undefined,
            orientation: (p as any).orientation,
            x: (p as any).x,
            y: (p as any).y,
            scale: (p as any).scale,
          });
        } catch (e) {
          console.warn("updatePageMeta failed", e);
        } finally {
          delete pendingPagePatchRef.current[pageId];
        }
      }, 300);
    },
    [updatePageMetaMutation, isSignedIn],
  );

  // Small helper: queue a toast (not related to undo but used in flows)
  function pushToast(
    text: string,
    kind: "error" | "info" | "success" = "info",
  ) {
    const id = newId("img");
    setToasts((ts) => ts.concat({ id, kind, text }));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000);
  }

  // Stable React Flow event handlers to prevent StoreUpdater loops
  const onConnectStable = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      (actions as any).addEdge?.(c.source, c.target);
    },
    [actions],
  );
  const onNodeClickStable = useCallback(
    (_: unknown, n: { id: string }) => actions.setCurrentPage(n.id),
    [actions],
  );

  // Intercept node changes: record final positions into store (single history snapshot)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let patch: Record<string, { x: number; y: number }> | null = null;
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds) as PageRFNode[];
        const ended = changes.some(
          (c: any) => c.type === "position" && c.dragging === false,
        );
        if (ended) {
          patch = {};
          for (const ch of changes as any[]) {
            if (ch.type === "position") {
              const id = ch.id as string;
              const n = next.find((nn) => nn.id === id);
              if (n) patch![id] = { x: n.position.x, y: n.position.y };
            }
          }
        }
        return next as any;
      });
      if (patch && Object.keys(patch).length) {
        // Defer store update to avoid nested state updates during render
        queueMicrotask(() => (actions as any).setNodePositions?.(patch!));
        // Persist page positions to Convex (debounced per page)
        for (const [pid, pos] of Object.entries(
          patch as Record<string, { x: number; y: number }>,
        )) {
          schedulePageUpdate(pid, {
            x: Math.round((pos as any).x),
            y: Math.round((pos as any).y),
          } as any);
        }
      }
    },
    [setNodes, actions, schedulePageUpdate],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      ids.forEach((id) => (actions as any).deletePage?.(id));
      const s = useEditorStore.getState();
      if (s.currentPageId && ids.includes(s.currentPageId)) {
        const nextId = s.order[0] ?? null;
        actions.setCurrentPage(nextId);
      }
      setNodes((ns) => ns.filter((n) => !ids.includes(n.id)));
    },
    [setNodes, actions],
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
        newId("tmp");
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

  const branchFrom = useCallback(
    async (parentId: string) => {
      const ok = await ensurePaid();
      if (!ok) return;
      const parent = useEditorStore.getState().pages[parentId];
      if (!parent) return;
      setBranchingParentId(parentId);
      setBranchPrompt(parent.prompt || "");
    },
    [ensurePaid],
  );
  useEffect(() => {
    branchFromRef.current = branchFrom;
  }, [branchFrom]);

  // branchFromWithPrompt is defined later (after generateInto) to avoid TS hoisting complaints

  const quickGenerate = useCallback(
    async (pageId: string) => {
      const allowed = await ensurePaid();
      if (!allowed) return;
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
    },
    [ensurePaid],
  );
  useEffect(() => {
    quickGenerateRef.current = quickGenerate;
  }, [quickGenerate]);

  // Build instructions for different generation modes.
  // Note: For text updates we keep the prompt minimal and do NOT include the
  // page's system prompt that is targeted at image generation. This prevents
  // the model from returning image-related disclaimers as text.
  const buildInstruction = useCallback(
    (
      page: Page,
      userPrompt: string,
      mode: "page" | "image" | "text" = "page",
    ) => buildInstructionPure(page, userPrompt, mode, standardsCatalog),
    [standardsCatalog],
  );

  // Main page generation pipeline.
  // We protect against stale async writes (after undo/redo) by checking a
  // per-page op token before every state write. See beginPageOp/isPageOpCurrent.
  /**
   * Server-driven page generation pipeline (image + text).
   * - Calls Convex actions for text (ai.generateTextLabel) and images (ai.generateImage).
   * - Updates children progressively in memory, then commits once for a clean undo step.
   * - Persists text via nodes.updateTextNode and image fileId via nodes.updateImageNode when signed in.
   */
  const generateInto = useCallback(
    async (pageId: string, prompt: string, pageOverride?: Page) => {
      const allowed = await ensurePaid();
      if (!allowed) return;
      try {
        const page = pageOverride ?? useEditorStore.getState().pages[pageId]!;
        const op = beginPageOp(pageId);
        writeUI(() =>
          setPagePatch(pageId, { generating: true, status: "Generating…" }),
        );

        const instructionText = buildInstruction(page, prompt, "text");
        const instructionImage = buildInstruction(page, prompt, "image");

        // Build next state in memory, then commit once
        const nextChildren = [...(page.children || [])];

        // 1) texts (persist to Convex as we update)
        for (let i = 0; i < nextChildren.length; i++) {
          const c = nextChildren[i];
          if (c.type === "text") {
            const tc = c as TextChild;
            const textPrompt = [
              instructionText,
              "You are updating a single text label on a printable page.",
              "Return only the new text, no commentary.",
              `Current text: "${tc.text || ""}"`,
            ].join("\n");
            try {
              const out = (await aiGenerateText({ prompt: textPrompt })) as any;
              if (!isPageOpCurrent(pageId, op)) return;
              const label = cleanSingleLineLabel(String(out?.text || ""));
              nextChildren[i] = { ...(tc as TextChild), text: label };
              // Persist text update when signed in
              if (isSignedIn && !isLocalNodeId(tc.id)) {
                try {
                  await updateTextNodeMutation({
                    nodeId: tc.id,
                    content: label,
                  });
                } catch {
                  /* best effort */
                }
              }
            } catch {
              /* ignore individual failure */
            }
          }
        }

        // 2) images
        for (let i = 0; i < nextChildren.length; i++) {
          const c = nextChildren[i];
          if (c.type === "image") {
            const ic = c as ImageChild;
            try {
              if (!projectId) throw new Error("No projectId");
              const out = await aiGenerateImage({
                projectId,
                prompt: instructionImage,
              });
              const url = out?.url as string;
              if (!isPageOpCurrent(pageId, op)) return;
              const fitted = await fitImageToRect(url, c.width, c.height);
              nextChildren[i] = {
                ...(ic as ImageChild),
                src: fitted,
                placeholder: false,
              };
              // Persist file link to node if signed in
              if (isSignedIn && !isLocalNodeId(ic.id) && out?.fileId) {
                try {
                  await updateImageNodeMutation({
                    nodeId: ic.id,
                    fileId: out.fileId as any,
                  });
                  nextChildren[i] = {
                    ...(nextChildren[i] as ImageChild),
                    fileId: out.fileId as any,
                  };
                } catch {}
              }
            } catch {
              /* ignore individual failure */
            }
          }
        }

        // 3) background
        let nextImageUrl: string | undefined = page.imageUrl;
        try {
          if (!projectId) throw new Error("No projectId");
          const out = (await aiGenerateImage({
            projectId,
            prompt: instructionImage,
          })) as any;
          const rawUrl = out?.url as string;
          if (!isPageOpCurrent(pageId, op)) return;
          nextImageUrl = await fitImageToPrintableArea(rawUrl, page);
          if (isSignedIn && out?.fileId)
            try {
              await setPageRenderFile({
                pageId: pageId as any,
                fileId: out.fileId as any,
              });
            } catch {}
        } catch {
          /* ignore background failure */
        }

        // Single commit at the end
        if (isPageOpCurrent(pageId, op)) {
          const prev = useEditorStore.getState().pages[pageId];
          if (prev) {
            revokeIfBlob(prev.originalImageUrl);
            revokeIfBlob(prev.imageUrl);
          }
          setPagePatch(pageId, {
            children: nextChildren,
            imageUrl: nextImageUrl,
            originalImageUrl: nextImageUrl ?? page.originalImageUrl,
          });
          writeUI(() =>
            setPagePatch(pageId, {
              generating: false,
              status: "",
            }),
          );
        }
      } catch (err) {
        pushToast(
          (err as Error).message || "Failed to generate image",
          "error",
        );
        writeUI(() => setPagePatch(pageId, { generating: false, status: "" }));
      }
    },
    [
      buildInstruction,
      setPagePatch,
      beginPageOp,
      isPageOpCurrent,
      ensurePaid,
      updateTextNodeMutation,
      isSignedIn,
      aiGenerateImage,
      aiGenerateText,
      projectId,
      updateImageNodeMutation,
      setPageRenderFile,
    ],
  );

  /**
   * Branching: create a child page on the server (Convex), then generate into it.
   * - Server returns the new page id and cloned nodes; we select the child locally.
   * - We then call generateInto(childId, prompt) to fill placeholders and/or background via server actions.
   */
  const branchFromWithPrompt = useCallback(
    async (parentId: string, prompt: string) => {
      const allowed = await ensurePaid();
      if (!allowed) return;
      try {
        const res = (await branchPageMutation({
          parentPageId: parentId,
          prompt,
        })) as any;
        const childId = (res?.pageId as string) || null;
        if (!childId) return;
        const parent = useEditorStore.getState().pages[parentId];
        // Add page locally with same meta used on server
        const childTitle = `${parent?.title || "Page"} variant`;
        (actions as any).addEmptyPage?.({
          id: childId,
          title: childTitle,
          orientation: parent?.orientation || "portrait",
        });
        // Add edge locally for immediate graph update
        (actions as any).addEdge?.(parentId, childId);
        // Position child next to parent locally
        try {
          const pos = useEditorStore.getState().nodePositions[parentId];
          if (pos)
            (actions as any).setNodePositions?.({
              [childId]: { x: pos.x + 280, y: pos.y },
            });
        } catch {}
        // Map returned nodes into local children array
        const nodes = (res?.nodes || []) as any[];
        const children = nodes.map((n) => {
          if (n.kind === "text") {
            return {
              id: n._id as string,
              type: "text",
              x: n.x,
              y: n.y,
              width: n.width,
              height: n.height,
              angle: n.rotation || 0,
              visible: true,
              locked: false,
              z: n.z || 0,
              text: n.content || "",
              fontFamily: n.style?.fontFamily || "Inter",
              fontSize: n.style?.fontSize || 24,
              fontWeight: n.style?.bold ? "bold" : "normal",
              italic: !!n.style?.italic,
              align: (n.style?.align as any) || "left",
            } as TextChild;
          } else {
            return {
              id: n._id as string,
              type: "image",
              x: n.x,
              y: n.y,
              width: n.width,
              height: n.height,
              angle: n.rotation || 0,
              visible: true,
              locked: false,
              z: n.z || 0,
              src: undefined,
              placeholder: !!n.placeholder,
              crop: null,
            } as ImageChild;
          }
        });
        (actions as any).replaceChildren?.(childId, children);
        actions.setCurrentPage(childId);
        // Small delay so Undo immediately after branch removes the page in one step
        setTimeout(() => {
          if (!useEditorStore.getState().pages[childId]) return;
          void generateInto(childId, prompt);
        }, 350);
      } catch (e) {
        console.warn("branchPage failed", e);
      }
    },
    [actions, branchPageMutation, generateInto, ensurePaid],
  );
  useEffect(() => {
    branchFromWithPromptRef.current = branchFromWithPrompt;
  }, [branchFromWithPrompt]);

  /**
   * Derivative generation for a child page using the parent as context.
   * - Fills image placeholders via ai.generateImage; updates background if needed.
   * - Uses op tokens so stale async writes are ignored after undo/redo.
   */
  const generateChildFromParent = useCallback(
    async (childId: string, parent: Page, prompt: string) => {
      const op = beginPageOp(childId);
      // If there are placeholders, generate into them on the child
      const placeholders = (parent.children || []).filter(
        (c) => c.type === "image" && !(c as ImageChild).src,
      );
      const childDraft: Page = { ...parent, id: childId, prompt };
      if (placeholders.length) {
        writeUI(() =>
          setPagePatch(childId, {
            generating: true,
            status: "Filling placeholders…",
          }),
        );
        // clone children array for child
        setPagePatch(childId, { children: [...(parent.children || [])] });
        const instruction = buildInstruction(childDraft, prompt, "image");
        let childrenNext = [...(parent.children || [])];
        for (let i = 0; i < childrenNext.length; i++) {
          const c = childrenNext[i];
          if (c.type === "image" && !(c as ImageChild).src) {
            if (!projectId) throw new Error("No projectId");
            const out = await aiGenerateImage({
              projectId: projectId!,
              prompt: instruction,
            });
            const url = out?.url as string;
            if (!isPageOpCurrent(childId, op)) return;
            childrenNext = childrenNext.map((cc, j) =>
              j === i
                ? { ...(cc as ImageChild), src: url, placeholder: false }
                : cc,
            );
            setPagePatch(childId, { children: childrenNext });
          }
        }
        if (isPageOpCurrent(childId, op))
          writeUI(() =>
            setPagePatch(childId, { generating: false, status: "" }),
          );
        return;
      }

      // Otherwise prefer transforming the flattened page background
      const flattened = await flattenPageToPng(parent);
      const baseUrl = flattened || parent.originalImageUrl || parent.imageUrl;
      writeUI(() =>
        setPagePatch(childId, {
          generating: true,
          status: baseUrl ? "Transforming…" : "Generating…",
        }),
      );
      if (baseUrl) {
        try {
          if (!projectId) throw new Error("No projectId");
          const instruction = buildInstruction(childDraft, prompt, "image");
          const out = (await aiGenerateImage({
            projectId,
            prompt: instruction,
          })) as any;
          const fitted = await fitImageToPrintableArea(
            out?.url as string,
            childDraft,
          );
          const prev = useEditorStore.getState().pages[childId];
          revokeIfBlob(prev?.originalImageUrl);
          revokeIfBlob(prev?.imageUrl);
          if (!isPageOpCurrent(childId, op)) return;
          setPagePatch(childId, { imageUrl: fitted, originalImageUrl: fitted });
          // Persist background render file for robust hydration
          if (isSignedIn && out?.fileId)
            try {
              await setPageRenderFile({
                pageId: childId as any,
                fileId: out.fileId as any,
              });
            } catch {}
          writeUI(() =>
            setPagePatch(childId, { generating: false, status: "" }),
          );
          return;
        } catch (e) {
          console.warn("Generate failed", e);
        }
      }
      await generateInto(childId, prompt, childDraft);
    },
    [
      buildInstruction,
      generateInto,
      setPagePatch,
      beginPageOp,
      isPageOpCurrent,
      aiGenerateImage,
      projectId,
      isSignedIn,
      setPageRenderFile,
    ],
  );
  useEffect(() => {
    generateChildFromParentRef.current = generateChildFromParent;
  }, [generateChildFromParent]);

  const deleteNode = useCallback(
    (pageId: string) => {
      if (!confirm("Delete this node?")) return;
      // Delete in Convex as well (best-effort)
      if (isSignedIn && !isLocalPageId(pageId)) {
        void deletePageMutation({ pageId });
      }
      const s = useEditorStore.getState();
      const incoming = s.edges.filter((e) => e.target === pageId);
      const preferred =
        incoming[0]?.source ?? s.order.find((x) => x !== pageId) ?? null;
      (actions as any).deletePageWithReattach?.(pageId, preferred);
      setNodes((ns) => ns.filter((n) => n.id !== pageId));
      if (currentPageId === pageId) actions.setCurrentPage(preferred);
    },
    [currentPageId, setNodes, actions, deletePageMutation, isSignedIn],
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
        const storePos = nodePositions[p.id];
        const pos = storePos
          ? { x: storePos.x, y: storePos.y }
          : existing?.position || {
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
            onChildrenChange: (
              pid: string,
              next: (TextChild | ImageChild)[],
            ) => {
              next.forEach((c) => scheduleNodeUpdate(c));
            },
            onCreateText: async ({
              pageId,
              x,
              y,
              width,
              height,
            }: {
              pageId: string;
              x: number;
              y: number;
              width: number;
              height: number;
            }) => {
              try {
                if (!isSignedIn || isLocalPageId(pageId)) {
                  return newId("t");
                }
                const id = await addTextNodeMutation({
                  pageId,
                  x,
                  y,
                  width,
                  height,
                  rotation: 0,
                  z: 0,
                  content: "",
                  style: {
                    fontFamily: "Inter",
                    fontSize: 24,
                    bold: false,
                    italic: false,
                    align: "left",
                  },
                });
                return id as string;
              } catch (e) {
                console.warn("addTextNode failed", e);
                return null;
              }
            },
            onCreateImage: async ({
              pageId,
              x,
              y,
              width,
              height,
            }: {
              pageId: string;
              x: number;
              y: number;
              width: number;
              height: number;
            }) => {
              try {
                if (!isSignedIn || isLocalPageId(pageId)) {
                  return newId("imgph");
                }
                const id = await addImageNodeMutation({
                  pageId,
                  x,
                  y,
                  width,
                  height,
                  rotation: 0,
                  z: 0,
                });
                return id as string;
              } catch (e) {
                console.warn("addImageNode failed", e);
                return null;
              }
            },
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
  }, [
    pages,
    currentPageId,
    setNodes,
    nodePositions,
    addTextNodeMutation,
    addImageNodeMutation,
    scheduleNodeUpdate,
    isSignedIn,
  ]);

  // Drop & paste handlers and keyboard shortcuts via hooks
  const flowRef = useRef<HTMLDivElement | null>(null);
  useDropAndPasteImport(
    flowRef,
    (url, title) => {
      addPageFromImage(url, title);
    },
    (msg) => pushToast(msg, "error"),
  );
  // Keyboard wiring: delegate to zundo helpers for undo/redo. We guard against
  // active inputs so typing in text fields doesn't trigger editor shortcuts.
  useKeyboardShortcuts({
    onQuickGenerate: () => {
      if (currentPageId) void quickGenerate(currentPageId);
    },
    onDeleteSelected: () => {
      const selected = nodes.filter((n) => n.selected).map((n) => n.id);
      if (selected.length > 1) deleteNodes(selected);
      else if (currentPageId) deleteNode(currentPageId);
    },
    onUndo: () => undo(),
    onRedo: () => redo(),
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
        className="h-14 px-4 border-b border-slate-200 bg-sky-50/60 backdrop-blur flex items-center justify-between relative z-20"
        role="toolbar"
        aria-label="Editor top bar"
      >
        <div className="flex items-center gap-3">
          <Image
            src="/logo.svg"
            alt="Checkfu Logo"
            width={96}
            height={24}
            className="h-6 w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Undo/Redo moved to the right side; icon-only, consistent height */}
          <button
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm transition select-none hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              undoFlash ? "bg-blue-50 border-blue-300" : ""
            }`}
            aria-label="Undo"
            title="Undo (Cmd/Ctrl+Z)"
            onClick={() => {
              setUndoFlash(true);
              setTimeout(() => setUndoFlash(false), 180);
              undo();
              // Clear transient spinners and invalidate old ops (UI-only)
              const ids = useEditorStore.getState().order;
              ids.forEach((id) =>
                writeUI(() =>
                  (actions as any).patchPage?.(id, {
                    generating: false,
                    status: "",
                  }),
                ),
              );
              pageOpSeqRef.current = {};
            }}
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
              <path d="M9 14l-4-4 4-4" />
              <path d="M5 10h9a5 5 0 1 1 0 10H7" />
            </svg>
          </button>
          <button
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm transition select-none hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              redoFlash ? "bg-blue-50 border-blue-300" : ""
            }`}
            aria-label="Redo"
            title="Redo (Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y)"
            onClick={() => {
              setRedoFlash(true);
              setTimeout(() => setRedoFlash(false), 180);
              redo();
              const ids = useEditorStore.getState().order;
              ids.forEach((id) =>
                writeUI(() =>
                  (actions as any).patchPage?.(id, {
                    generating: false,
                    status: "",
                  }),
                ),
              );
              pageOpSeqRef.current = {};
            }}
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
              <path d="M15 6l4 4-4 4" />
              <path d="M19 10H10a5 5 0 1 0 0 10h7" />
            </svg>
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 px-3 rounded-md border text-sm disabled:opacity-50 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Export to PDF"
            aria-busy={exporting}
            disabled={!pages.length || exporting}
            onClick={async () => {
              if (!(await ensurePaid())) return;
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
              setExporting(true);
              try {
                await exportPagesToPdf(toExport);
                pushToast("Exported PDF", "success");
              } catch {
                pushToast("Failed to export PDF", "error");
              } finally {
                setExporting(false);
              }
            }}
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
              <path d="M12 3v12" />
              <path d="M8 11l4 4 4-4" />
              <path d="M6 19h12" />
            </svg>
            <span>Export to PDF</span>
            {exporting ? (
              <span
                className="h-4 w-4 rounded-full border-2 border-sky-600 border-t-transparent animate-spin"
                aria-hidden
              />
            ) : null}
            {nodes.filter((n) => n.selected).length > 1 ? (
              <span
                className="px-1.5 h-5 min-w-[1.25rem] inline-flex items-center justify-center rounded bg-blue-100 text-blue-800 text-xs"
                aria-label="Selected count"
              >
                {nodes.filter((n) => n.selected).length}
              </span>
            ) : null}
          </button>
          {/* API Key settings removed — generation runs on the server. */}
          <div className="ml-2 pl-2 border-l flex items-center">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="inline-flex h-9 items-center gap-2 px-3 rounded-md border text-sm transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
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
                (async () => {
                  // In demo (no projectId or unsigned), create a local page only
                  if (!projectId || !isSignedIn) {
                    const p: Page = {
                      id: newId("p"),
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
                    return;
                  }
                  try {
                    const pageId = await createPageMutation({
                      projectId,
                      title: "New Page",
                      kind: "coloring",
                      x: 0,
                      y: 0,
                    });
                    const p: Page = {
                      id: pageId as string,
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
                  } catch (e) {
                    console.warn("createPage failed", e);
                  }
                })();
                // setCurrentPage is already done inside addEmptyPage; avoid redundant set
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
              edges={rfEdges}
              fitView
              fitViewOptions={RF_FIT_VIEW_OPTIONS}
              defaultViewport={RF_DEFAULT_VIEWPORT}
              minZoom={0.05}
              maxZoom={2.5}
              translateExtent={RF_TRANSLATE_EXTENT}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
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
                      onChange={(e) => {
                        const val = e.target.value;
                        setPagePatch(currentPageId!, { title: val });
                        schedulePageUpdate(currentPageId!, { title: val });
                      }}
                    />
                    <label htmlFor="page-orientation">Orientation</label>
                    <select
                      id="page-orientation"
                      className="border rounded px-2 py-1"
                      value={currentPage?.orientation || "portrait"}
                      onChange={(e) => {
                        const val = e.target.value as Orientation;
                        setPagePatch(currentPageId!, { orientation: val });
                        schedulePageUpdate(currentPageId!, {
                          orientation: val,
                        } as any);
                      }}
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
                              scheduleNodeUpdate({ ...(child as any), x: v });
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
                              scheduleNodeUpdate({ ...(child as any), y: v });
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
                              if (!isText)
                                scheduleNodeUpdate({
                                  ...(child as any),
                                  width: v,
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
                              if (!isText)
                                scheduleNodeUpdate({
                                  ...(child as any),
                                  height: v,
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
                                onBlur={(e) => {
                                  scheduleNodeUpdate({
                                    ...(child as any),
                                    text: e.currentTarget.value,
                                  } as any);
                                }}
                                onKeyDown={(e) => {
                                  if (
                                    (e.metaKey || e.ctrlKey) &&
                                    e.key.toLowerCase() === "z"
                                  ) {
                                    e.preventDefault();
                                    if (e.shiftKey) redo();
                                    else undo();
                                  } else if (
                                    (e.metaKey || e.ctrlKey) &&
                                    e.key.toLowerCase() === "y"
                                  ) {
                                    e.preventDefault();
                                    redo();
                                  }
                                }}
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
                                onBlur={(e) => {
                                  const v = parseFloat(
                                    e.currentTarget.value || "24",
                                  );
                                  scheduleNodeUpdate({
                                    ...(child as any),
                                    fontSize: v,
                                  } as any);
                                }}
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
                                onBlur={(e) => {
                                  const v = e.currentTarget
                                    .value as TextChild["align"];
                                  scheduleNodeUpdate({
                                    ...(child as any),
                                    align: v,
                                  } as any);
                                }}
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
                                  const ok = await ensurePaid();
                                  if (!ok) return;
                                  const promptText = (
                                    nodePrompts[child.id] ?? ""
                                  ).trim();
                                  try {
                                    const op = beginPageOp(currentPageId!);
                                    writeUI(() =>
                                      setPagePatch(currentPageId!, {
                                        generating: true,
                                        status: "Generating text…",
                                      }),
                                    );
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
                                    const out = (await aiGenerateText({
                                      prompt: textPrompt,
                                    })) as any;
                                    if (!isPageOpCurrent(currentPageId!, op))
                                      return;
                                    const label = cleanSingleLineLabel(
                                      String(out?.text || ""),
                                    );
                                    setPagePatch(currentPageId!, {
                                      children: (
                                        currentPage?.children || []
                                      ).map((c) =>
                                        c.id === child.id
                                          ? { ...(c as TextChild), text: label }
                                          : c,
                                      ),
                                    });
                                    // Persist text to Convex when signed in
                                    if (
                                      isSignedIn &&
                                      !isLocalNodeId(child.id)
                                    ) {
                                      try {
                                        await updateTextNodeMutation({
                                          nodeId: child.id,
                                          content: label,
                                        });
                                      } catch {}
                                    }
                                    writeUI(() =>
                                      setPagePatch(currentPageId!, {
                                        generating: false,
                                        status: "",
                                      }),
                                    );
                                  } catch (err) {
                                    writeUI(() =>
                                      setPagePatch(currentPageId!, {
                                        generating: false,
                                        status: "",
                                      }),
                                    );
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
                            <div>
                              <button
                                className="mt-1 px-2 py-1 border rounded text-xs text-red-700 border-red-300"
                                onClick={() => {
                                  const cid = child.id;
                                  setPagePatch(currentPageId!, {
                                    children: (
                                      currentPage.children || []
                                    ).filter((c) => c.id !== cid),
                                    selectedChildId: null,
                                  });
                                  // Persist to Convex (signed-in only)
                                  if (isSignedIn && !isLocalNodeId(cid))
                                    void deleteChildNodeMutation({
                                      nodeId: cid,
                                    });
                                }}
                              >
                                Delete Text
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
                                    revokeIfBlob(old);
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
                                  const ok = await ensurePaid();
                                  if (!ok) return;
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
                                    if (!projectId)
                                      throw new Error("No projectId");
                                    const out = await aiGenerateImage({
                                      projectId,
                                      prompt: instruction,
                                    });
                                    const url = out?.url as string;
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
                                            fileId:
                                              (out?.fileId as any) ??
                                              (c as any).fileId,
                                          }
                                        : c,
                                    );
                                    setPagePatch(currentPageId!, {
                                      children: next,
                                      generating: false,
                                      status: "",
                                    });
                                    // persist fileId on node
                                    const fid = out?.fileId as any;
                                    if (
                                      isSignedIn &&
                                      fid &&
                                      !isLocalNodeId(child.id)
                                    )
                                      void updateImageNodeMutation({
                                        nodeId: child.id,
                                        fileId: fid,
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
                            <div>
                              <button
                                className="mt-1 px-2 py-1 border rounded text-xs text-red-700 border-red-300"
                                onClick={() => {
                                  const cid = child.id;
                                  setPagePatch(currentPageId!, {
                                    children: (
                                      currentPage.children || []
                                    ).filter((c) => c.id !== cid),
                                    selectedChildId: null,
                                  });
                                  // Persist to Convex (signed-in only)
                                  if (isSignedIn && !isLocalNodeId(cid))
                                    void deleteChildNodeMutation({
                                      nodeId: cid,
                                    });
                                }}
                              >
                                Delete Image
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
      {/* Settings modal removed */}
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
