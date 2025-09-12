import { create } from "zustand";
import { temporal } from "zundo";
import { newId } from "@/lib/ids";

/**
 * Checkfu — Domain Store (Undo/Redo via zundo)
 *
 * This file contains the domain model for the editor (pages, children, graph
 * edges, and nodePositions). It is wrapped with zundo's temporal middleware so
 * the domain can be undone/redone reliably.
 *
 * What goes into history (domain):
 * - pages (and their children),
 * - order (top-level page ordering),
 * - edges (branching graph),
 * - nodePositions (React Flow node coordinates).
 *
 * What never goes into history (UI-only):
 * - currentPageId (focus),
 * - selectedChildId (per page),
 * - generating/status (spinners).
 *
 * We keep UI-only writes out of history by either:
 * - pausing temporal inside the relevant actions (e.g., setCurrentPage,
 *   selectChild), or
 * - using the writeUI helper provided at the bottom of this file.
 *
 * This separation ensures a user pressing Undo/Redo never loses their Redo
 * stack due to incidental UI toggles, and that Undo/Redo steps are clean,
 * deterministic snapshots of the domain.
 */
/**
 * Undo/Redo strategy (zundo temporal middleware)
 *
 * - We keep the domain model in a single Zustand store and wire zundo on top.
 * - History should include only meaningful edits to the domain (pages, order,
 *   which page is focused, and nodePositions) — but exclude transient/UI bits.
 * - We therefore:
 *   - partialize: strip `generating`, `status`, and `selectedChildId` so undo
 *     does not restore spinners or selections — users expect undo to change
 *     content, not bring back a loading overlay or focus state.
 *   - use actions.selectChild with pause/resume: selection changes are frequent
 *     and should not create history entries. We briefly pause history during
 *     the selection write to avoid extra undo steps.
 *   - expose helpers (undo/redo/clear/pause/resume) for ergonomics and tests.
 * - `nodePositions` is recorded so dragging nodes is a single undoable step.
 */

export type Orientation = "portrait" | "landscape";

export type ChildBase = {
  id: string;
  type: "text" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  visible?: boolean;
  locked?: boolean;
  z?: number;
};

export type TextChild = ChildBase & {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  italic?: boolean;
  align?: "left" | "center" | "right";
};

export type ImageChild = ChildBase & {
  type: "image";
  src?: string;
  placeholder?: boolean;
  crop?: { left: number; top: number; width: number; height: number } | null;
};

export type PageStatus = "Transforming…" | "Generating…" | "" | string;

export type Page = {
  id: string;
  title: string;
  orientation: Orientation;
  imageUrl?: string;
  originalImageUrl?: string;
  prompt?: string;
  systemPrompt?: string;
  systemPromptEdited?: boolean;
  promptPresetKey?: string | null;
  bwThreshold?: number;
  pageType?: "worksheet" | "coloring";
  coloringStyle?: "classic" | "anime" | "retro";
  standards?: string[];
  generating?: boolean;
  status?: PageStatus;
  children: (TextChild | ImageChild)[];
  selectedChildId?: string | null;
};

// Edges in the page graph (for branching). Kept in history alongside pages.
export type GraphEdge = { id: string; source: string; target: string };

type EditorState = {
  pages: Record<string, Page>;
  order: string[];
  currentPageId: string | null;
  nodePositions: Record<string, { x: number; y: number }>;
  edges: GraphEdge[];
};

type EditorActions = {
  setCurrentPage: (id: string | null) => void;
  addEmptyPage: (overrides?: Partial<Page>) => string;
  addPageFromImage: (
    url: string,
    title?: string,
    overrides?: Partial<Page>,
  ) => string;
  deletePage: (id: string) => void;
  patchPage: (id: string, patch: Partial<Page>) => void;
  replaceChildren: (id: string, next: (TextChild | ImageChild)[]) => void;
  selectChild: (id: string, childId: string | null) => void;
  setNodePositions: (patch: Record<string, { x: number; y: number }>) => void;
  // Graph actions
  addEdge: (source: string, target: string) => string;
  removeEdgesByIds: (ids: string[]) => void;
  setEdges: (edges: GraphEdge[]) => void;
  branch: (parentId: string, prompt: string) => string; // atomic: add page + edge
  deletePageWithReattach: (
    id: string,
    preferredParentId?: string | null,
  ) => void;
};

type Store = EditorState & { actions: EditorActions };

// Keep the history limit explicit for readability. Adjust as needed.
const HISTORY_LIMIT = 100;

export const useEditorStore = create<Store>()(
  temporal(
    (set, get) => ({
      pages: {},
      order: [],
      currentPageId: null,
      nodePositions: {},
      edges: [],
      actions: {
        /**
         * Focus a page without creating a spurious history entry.
         * A no-op if the page is already current.
         * Wrapped with temporal pause/resume so it never clears redo.
         */
        setCurrentPage: (id) => {
          if (get().currentPageId === id) return;
          try {
            useEditorStore.temporal.getState().pause();
          } catch {}
          set({ currentPageId: id });
          try {
            useEditorStore.temporal.getState().resume();
          } catch {}
        },
        addEmptyPage: (overrides) => {
          const overrideId = overrides?.id as string | undefined;
          const id = overrideId || newId("p");
          const defaults: Page = {
            id,
            title: "New Page",
            orientation: "portrait",
            bwThreshold: 200,
            pageType: "coloring",
            coloringStyle: "classic",
            standards: [],
            systemPrompt: "",
            systemPromptEdited: false,
            promptPresetKey: null,
            children: [],
            selectedChildId: null,
          };
          const page: Page = { ...defaults, ...(overrides || {}), id };
          set((s) => ({
            pages: { ...s.pages, [id]: page },
            order: s.order.concat(id),
            currentPageId: id,
          }));
          return id;
        },
        addPageFromImage: (url, title = "Image", overrides) => {
          const id = get().actions.addEmptyPage({
            title,
            originalImageUrl: url,
            imageUrl: url,
            ...(overrides || {}),
          });
          return id;
        },
        deletePage: (id) =>
          set((s) => {
            const { [id]: _, ...rest } = s.pages;
            const order = s.order.filter((x) => x !== id);
            const currentPageId =
              s.currentPageId === id ? order[0] || null : s.currentPageId;
            const edges = s.edges.filter(
              (e) => e.source !== id && e.target !== id,
            );
            return { pages: rest, order, currentPageId, edges };
          }),
        patchPage: (id, patch) =>
          set((s) => {
            const prev = s.pages[id];
            if (!prev) return s;
            return { pages: { ...s.pages, [id]: { ...prev, ...patch } } };
          }),
        replaceChildren: (id, next) =>
          set((s) => {
            const prev = s.pages[id];
            if (!prev) return s;
            return { pages: { ...s.pages, [id]: { ...prev, children: next } } };
          }),
        /**
         * UI-only selection inside a page. We do not want a history entry for
         * simply changing which child is selected, so we pause history while
         * writing this change.
         */
        selectChild: (id, childId) => {
          // Selection is UI state — do not record it in undo history
          try {
            useEditorStore.temporal.getState().pause();
          } catch {}
          set((s) => {
            const prev = s.pages[id];
            if (!prev) return s;
            if ((prev.selectedChildId ?? null) === (childId ?? null)) return s;
            return {
              pages: {
                ...s.pages,
                [id]: { ...prev, selectedChildId: childId },
              },
            };
          });
          try {
            useEditorStore.temporal.getState().resume();
          } catch {}
        },
        /**
         * Persist final React Flow node coordinates. This is called once per
         * drag gesture (on drag end) so undo/redo jumps between stable node
         * layouts instead of every intermediate mouse move.
         */
        setNodePositions: (patch) =>
          set((s) => ({
            nodePositions: { ...s.nodePositions, ...patch },
          })),

        // Graph helpers
        addEdge: (source, target) => {
          const id = newId("e");
          set((s) => ({ edges: s.edges.concat({ id, source, target }) }));
          return id;
        },
        removeEdgesByIds: (ids) =>
          set((s) => ({ edges: s.edges.filter((e) => !ids.includes(e.id)) })),
        setEdges: (edges) => set(() => ({ edges })),

        branch: (parentId, prompt) => {
          const parent = get().pages[parentId];
          if (!parent) return "";
          const id = newId("p");
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
          const edgeId = newId("e");
          set((s) => ({
            pages: { ...s.pages, [id]: child },
            order: s.order.concat(id),
            currentPageId: id,
            edges: s.edges.concat({ id: edgeId, source: parentId, target: id }),
          }));
          return id;
        },

        deletePageWithReattach: (id, preferredParentId) =>
          set((s) => {
            if (!s.pages[id]) return s;
            const incoming = s.edges.filter((e) => e.target === id);
            const outgoing = s.edges.filter((e) => e.source === id);
            const parentId =
              preferredParentId ||
              (incoming.length
                ? incoming[0].source
                : s.order.find((x) => x !== id) || null);

            // remove edges touching the node
            let edges = s.edges.filter(
              (e) => e.source !== id && e.target !== id,
            );

            // reattach children to chosen parent
            if (parentId) {
              const newEdges = outgoing.map((e) => ({
                id: newId("e"),
                source: parentId!,
                target: e.target,
              }));
              edges = edges.concat(newEdges);
            }

            const { [id]: _drop, ...rest } = s.pages;
            const order = s.order.filter((x) => x !== id);
            const currentPageId =
              s.currentPageId === id
                ? parentId || order[0] || null
                : s.currentPageId;
            return { pages: rest, order, currentPageId, edges };
          }),
      },
    }),
    {
      // Only record meaningful, content-affecting fields in history.
      // We strip transient UI bits so undo/redo operates on content only.
      // Note: currentPageId is considered UI and is NOT captured in history.
      partialize: (s) => {
        const pagesClean: Record<string, Page> = {} as any;
        for (const id of Object.keys(s.pages)) {
          const { generating, status, selectedChildId, ...keep } = s.pages[id];
          pagesClean[id] = keep as Page;
        }
        return {
          pages: pagesClean,
          order: s.order,
          nodePositions: s.nodePositions,
          edges: s.edges,
        } as Partial<typeof s>;
      },
      limit: HISTORY_LIMIT,
    },
  ),
);

// Small convenience helpers so components/hooks can call undo/redo directly.
export const undo = () => useEditorStore.temporal.getState().undo();
export const redo = () => useEditorStore.temporal.getState().redo();
export const clearHistory = () => useEditorStore.temporal.getState().clear();
export const pauseHistory = () => useEditorStore.temporal.getState().pause();
export const resumeHistory = () => useEditorStore.temporal.getState().resume();

/**
 * Run a write that should not affect history (UI-only toggles).
 * We pause the temporal middleware, run the updater, then resume.
 */
export const writeUI = <T>(fn: () => T): T => {
  const t = useEditorStore.temporal.getState();
  try {
    t.pause();
  } catch {}
  const r = fn();
  try {
    t.resume();
  } catch {}
  return r;
};

export const useActions = () => useEditorStore((s) => s.actions);
export const usePageById = (id: string | null | undefined) =>
  useEditorStore((s) => (id ? (s.pages[id] ?? null) : null));
export const usePages = () =>
  useEditorStore((s) => s.order.map((id) => s.pages[id]).filter(Boolean));
export const useCurrentPageId = () => useEditorStore((s) => s.currentPageId);
export const useCurrentPage = () =>
  useEditorStore((s) => (s.currentPageId ? s.pages[s.currentPageId] : null));
export const useEdges = () => useEditorStore((s) => s.edges);
