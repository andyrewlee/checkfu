import type { Canvas } from "fabric";

type SelectionEvt = {
  selected?: Array<{ checkfuId?: string }>;
};

export function wireSelectionHandlers(
  canvas: Canvas,
  isHydrating: () => boolean,
  onSelect: (id: string | null) => void,
): () => void {
  let last: string | null = null;

  const setFromSelection = (evt: unknown) => {
    if (isHydrating()) return;
    const e = evt as SelectionEvt | undefined;
    const id = e?.selected?.[0]?.checkfuId ?? null;
    if (id !== last) {
      last = id;
      onSelect(id);
    }
  };

  const clearSelection = () => {
    if (isHydrating()) return;
    if (last !== null) {
      last = null;
      onSelect(null);
    }
  };

  canvas.on("selection:created", setFromSelection as unknown as () => void);
  canvas.on("selection:updated", setFromSelection as unknown as () => void);
  canvas.on("selection:cleared", clearSelection as unknown as () => void);

  return () => {
    canvas.off("selection:created", setFromSelection as unknown as () => void);
    canvas.off("selection:updated", setFromSelection as unknown as () => void);
    canvas.off("selection:cleared", clearSelection as unknown as () => void);
  };
}
