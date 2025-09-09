import { create } from "zustand";

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

type EditorState = {
  pages: Record<string, Page>;
  order: string[];
  currentPageId: string | null;
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
};

type Store = EditorState & { actions: EditorActions };

export const useEditorStore = create<Store>((set, get) => ({
  pages: {},
  order: [],
  currentPageId: null,
  actions: {
    setCurrentPage: (id) => set({ currentPageId: id }),
    addEmptyPage: (overrides) => {
      const overrideId = overrides?.id as string | undefined;
      const id =
        overrideId ||
        globalThis.crypto?.randomUUID?.() ||
        `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
        return { pages: rest, order, currentPageId };
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
    selectChild: (id, childId) =>
      set((s) => {
        const prev = s.pages[id];
        if (!prev) return s;
        if ((prev.selectedChildId ?? null) === (childId ?? null)) return s;
        return {
          pages: { ...s.pages, [id]: { ...prev, selectedChildId: childId } },
        };
      }),
  },
}));

export const useActions = () => useEditorStore((s) => s.actions);
export const usePageById = (id: string | null | undefined) =>
  useEditorStore((s) => (id ? (s.pages[id] ?? null) : null));
export const usePages = () =>
  useEditorStore((s) => s.order.map((id) => s.pages[id]).filter(Boolean));
export const useCurrentPageId = () => useEditorStore((s) => s.currentPageId);
export const useCurrentPage = () =>
  useEditorStore((s) => (s.currentPageId ? s.pages[s.currentPageId] : null));
