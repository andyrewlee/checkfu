"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef } from "react";
import type { TextChild, ImageChild } from "@/store/useEditorStore";
import { pagePx } from "@/lib/image/pageMetrics";

type Props = {
  pageId: string;
  orientation: "portrait" | "landscape";
  items: (TextChild | ImageChild)[];
  selectedChildId: string | null;
  onChildrenChange: (pageId: string, next: (TextChild | ImageChild)[]) => void;
  onSelectChild: (pageId: string, childId: string | null) => void;
};

export default function PageCanvasFabric(props: Props) {
  const {
    pageId,
    orientation,
    items,
    selectedChildId,
    onChildrenChange,
    onSelectChild,
  } = props;
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<any | null>(null);
  const textChangeTimerRef = useRef<number | null>(null);
  // Hydration fence: suppress commits/selection propagation during programmatic updates
  const hydratingRef = useRef<number>(0);
  const isHydrating = () => hydratingRef.current > 0;
  const withHydration = async <T,>(fn: () => Promise<T> | T): Promise<T> => {
    hydratingRef.current++;
    try {
      return await fn();
    } finally {
      hydratingRef.current--;
    }
  };
  // Keep latest items for event handlers (avoid stale closures on undo/redo)
  const itemsLatestRef = useRef<(TextChild | ImageChild)[]>(items);
  itemsLatestRef.current = items;

  const dims = useMemo(() => {
    const { pxW, pxH } = pagePx(orientation);
    return { w: pxW, h: pxH };
  }, [orientation]);

  // initialize Fabric (guarded for Strict Mode double-invoke)
  //
  // Direction of data flow:
  // - User edits on the canvas → we commit minimal changes back to the store
  //   via onChildrenChange (see commit()).
  // - Store changes (items, selectedChildId) → we hydrate Fabric so the canvas
  //   mirrors the authoritative state. Equality checks avoid redundant writes.
  useEffect(() => {
    if (fabricRef.current) return;
    (async () => {
      const { Canvas, IText, Image, Rect, Line, Group } = await import(
        "fabric"
      );
      if (!canvasElRef.current) return;
      const el = canvasElRef.current as HTMLCanvasElement;
      // Defensive: if element was previously initialized, clear fabric markers
      if (el.hasAttribute("data-fabric")) {
        try {
          el.removeAttribute("data-fabric");
          el.classList.remove("lower-canvas");
        } catch {}
      }
      const canvas = new Canvas(el, {
        width: dims.w,
        height: dims.h,
        selection: true,
        preserveObjectStacking: true,
        renderOnAddRemove: false,
      });
      fabricRef.current = canvas;

      // selection events (deduped) and force redraw to keep handles visible
      const lastSelRef = { current: null as string | null };
      const setFromSelection = (e: any) => {
        if (isHydrating()) return;
        const obj = e?.selected?.[0];
        const id: string | null = obj?.checkfuId || null;
        if (id !== lastSelRef.current) {
          onSelectChild(pageId, id);
          lastSelRef.current = id;
          canvas.requestRenderAll();
        }
      };
      canvas.on("selection:created", setFromSelection);
      canvas.on("selection:updated", setFromSelection);
      canvas.on("selection:cleared", () => {
        if (isHydrating()) return;
        if (lastSelRef.current !== null) {
          lastSelRef.current = null;
          onSelectChild(pageId, null);
        }
      });

      // commit edits back to state
      const normalizeTextScaling = (obj: any) => {
        if (obj?.checkfuType !== "text") return;
        const sx = obj.scaleX || 1;
        const sy = obj.scaleY || 1;
        if (sx !== 1 || sy !== 1) {
          const base = obj.fontSize || 24;
          const nextFont = Math.max(6, Math.round(base * Math.max(sx, sy)));
          obj.set({ fontSize: nextFont, scaleX: 1, scaleY: 1 });
          if (typeof obj.initDimensions === "function") obj.initDimensions();
        }
      };

      // Robust equality:
      // - id-based and order-insensitive
      // - tolerant to tiny float jitter
      // - ignores derived text width/height (Fabric measures text)
      const within = (a = 0, b = 0, eps = 0.5) => Math.abs(a - b) <= eps;
      const same = (
        a: (TextChild | ImageChild)[],
        b: (TextChild | ImageChild)[],
      ) => {
        if (a.length !== b.length) return false;
        const map = new Map<string, any>(b.map((c: any) => [c.id, c]));
        for (const x of a as any[]) {
          const y = map.get(x.id);
          if (!y || x.type !== y.type) return false;
          if (!within(x.x, y.x) || !within(x.y, y.y)) return false;
          if (!within(x.angle || 0, y.angle || 0)) return false;
          if (!!x.visible !== !!y.visible) return false;
          if (!!x.locked !== !!y.locked) return false;
          if (x.type === "text") {
            if (
              x.text !== y.text ||
              x.fontFamily !== y.fontFamily ||
              x.fontSize !== y.fontSize ||
              x.fontWeight !== y.fontWeight ||
              !!x.italic !== !!y.italic ||
              (x.align || "left") !== (y.align || "left")
            )
              return false;
            // Ignore width/height for text nodes
          } else {
            if (x.src !== y.src) return false;
            if (!within(x.width, y.width, 1) || !within(x.height, y.height, 1))
              return false;
          }
        }
        return true;
      };

      // helper: build a store child from a Fabric object
      const buildChildFromObj = (obj: any): TextChild | ImageChild => {
        const round = (n: number | undefined) =>
          Math.max(0, Math.round(n ?? 0));
        const base = {
          id: obj.checkfuId as string,
          type: obj.checkfuType as "text" | "image",
          x: round(obj.left),
          y: round(obj.top),
          width: round((obj.width || 1) * (obj.scaleX || 1)),
          height: round((obj.height || 1) * (obj.scaleY || 1)),
          angle: round(obj.angle || 0),
          visible: !!obj.visible,
          locked: !obj.selectable,
          z: 0,
        };

        if (obj.checkfuType === "text") {
          return {
            ...base,
            text: obj.text || "",
            fontFamily: obj.fontFamily || "Inter",
            fontSize: obj.fontSize || 24,
            fontWeight: obj.fontWeight || "normal",
            italic: obj.fontStyle === "italic",
            align: obj.textAlign || "left",
          } as TextChild;
        } else {
          return {
            ...base,
            src: (obj.checkfuSrc as string) ?? undefined,
            placeholder: !!obj.checkfuPlaceholder,
            crop: null,
          } as ImageChild;
        }
      };

      const commit = () => {
        if (isHydrating()) return;
        // Convert scaling on text into font size to keep a clean model
        canvas.getObjects().forEach(normalizeTextScaling);

        // 1) Read the authoritative state from Fabric
        const draft = canvas.getObjects().map(buildChildFromObj);

        // 2) Preserve previous ordering where possible (more stable diffs)
        const prevOrder = new Map<string, number>(
          (itemsLatestRef.current as (TextChild | ImageChild)[]).map((c, i) => [
            c.id,
            i,
          ]),
        );
        draft.sort((a, b) => {
          const ai = prevOrder.has(a.id)
            ? (prevOrder.get(a.id) as number)
            : Number.POSITIVE_INFINITY;
          const bi = prevOrder.has(b.id)
            ? (prevOrder.get(b.id) as number)
            : Number.POSITIVE_INFINITY;
          return ai - bi;
        });

        // 3) Avoid no-op writes
        if (!same(draft, itemsLatestRef.current)) {
          requestAnimationFrame(() => onChildrenChange(pageId, draft));
        }
        canvas.requestRenderAll();
      };
      // Throttle commits to one per frame
      let commitRAF: number | null = null;
      const scheduleCommit = () => {
        if (isHydrating()) return;
        if (commitRAF) return;
        commitRAF = requestAnimationFrame(() => {
          commitRAF = null;
          commit();
        });
      };
      canvas.on("object:modified", scheduleCommit);
      // capture text edits so state updates when leaving edit mode
      canvas.on("text:editing:exited", commit as any);
      // also capture live text changes (debounced commit)
      const onTextChanged = () => {
        if (textChangeTimerRef.current) {
          clearTimeout(textChangeTimerRef.current);
          textChangeTimerRef.current = null;
        }
        textChangeTimerRef.current = window.setTimeout(() => {
          commit();
          textChangeTimerRef.current = null;
        }, 120);
      };
      canvas.on("text:changed", onTextChanged as any);
      const onTransforming = () => {
        canvas.requestRenderAll();
      };
      canvas.on("object:moving", onTransforming);
      canvas.on("object:scaling", onTransforming);
      canvas.on("object:rotating", onTransforming);

      // drag and drop from palette or files
      const handleDrop = async (ev: DragEvent | any) => {
        const isFabricEvt = !!(ev as any)?.e;
        const e = isFabricEvt ? (ev as any).e : ev;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const dt: DataTransfer | undefined = e?.dataTransfer;
        if (!dt) return;
        // Do NOT hydrate here: it can erase freshly-added, not-yet-committed
        // objects when multiple drops happen quickly. We commit after add.
        const payload = dt.getData("application/checkfu-node");
        const pointer = canvas.getPointer(e);
        if (payload) {
          try {
            const data = JSON.parse(payload);
            if (data.kind === "text") {
              const id = crypto.randomUUID();
              const t = new IText("New text", {
                left: pointer.x,
                top: pointer.y,
                fontFamily: "Inter",
                fontSize: 24,
                fill: "#000",
              });
              t.set({ scaleX: 1, scaleY: 1 });
              (t as any).checkfuId = id;
              (t as any).checkfuType = "text";
              canvas.add(t);
              canvas.setActiveObject(t);
              commit();
              canvas.requestRenderAll();
              return;
            } else if (data.kind === "image") {
              // Create placeholder rectangle with an X
              const id = crypto.randomUUID();
              const w = 200,
                h = 150;
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
              const g: any = new Group([rect, l1, l2], {
                left: pointer.x,
                top: pointer.y,
              });
              g.checkfuId = id;
              g.checkfuType = "image";
              g.checkfuSrc = undefined;
              canvas.add(g);
              canvas.setActiveObject(g);
              commit();
              canvas.requestRenderAll();
              return;
            }
          } catch {}
        }
        // handle file drop of images
        const file = Array.from(dt.files || []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (file) {
          const url = URL.createObjectURL(file);
          const img: any = await Image.fromURL(url, {
            crossOrigin: "anonymous",
          });
          const id = crypto.randomUUID();
          img.set({
            left: pointer.x,
            top: pointer.y,
            scaleX: 0.5,
            scaleY: 0.5,
          });
          (img as any).checkfuId = id;
          (img as any).checkfuType = "image";
          (img as any).checkfuSrc = url;
          canvas.add(img);
          canvas.setActiveObject(img);
          commit();
          canvas.requestRenderAll();
        }
      };
      const stopOver = (ev: DragEvent | any) => {
        const e = (ev as any)?.e || ev;
        e?.preventDefault?.();
        e?.stopPropagation?.();
      };
      canvas.on("dragover", stopOver as any);
      canvas.on("drop", handleDrop as any);

      // initial paint under hydration fence
      await withHydration(async () => {
        await hydrate(canvas, items);
        canvas.requestRenderAll();
      });
    })();

    return () => {
      try {
        fabricRef.current?.dispose();
      } catch {}
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resize Fabric when dims change
  useEffect(() => {
    const canvas = fabricRef.current as any;
    if (!canvas) return;
    if (typeof canvas.setWidth === "function") canvas.setWidth(dims.w);
    if (typeof canvas.setHeight === "function") canvas.setHeight(dims.h);
    canvas.requestRenderAll();
  }, [dims.w, dims.h]);

  // sync objects from state (fenced)
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    void withHydration(async () => {
      canvas.discardActiveObject();
      await hydrate(canvas, items);
      canvas.requestRenderAll();
    });
  }, [items]);

  // programmatic selection from store (fenced)
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const id = selectedChildId ?? null;
    void withHydration(async () => {
      await hydrate(canvas, items);
      if (!id) {
        canvas.discardActiveObject();
      } else {
        const target = canvas.getObjects().find((o: any) => o.checkfuId === id);
        if (target) {
          canvas.setActiveObject(target);
          if (typeof (target as any).setCoords === "function")
            (target as any).setCoords();
        }
      }
      canvas.requestRenderAll();
    });
  }, [selectedChildId, items]);

  return (
    <canvas
      ref={canvasElRef}
      width={dims.w}
      height={dims.h}
      aria-label="Page canvas"
    />
  );
}

async function hydrate(canvas: any, items: (TextChild | ImageChild)[]) {
  const { IText, Image, Rect, Line, Group } = await import("fabric");
  const current = new Map<string, any>();
  canvas.getObjects().forEach((o: any) => current.set(o.checkfuId, o));
  // Track active selection to preserve across replacements
  const active = (canvas.getActiveObject?.() as any) || null;
  const activeId = active?.checkfuId ?? null;
  let reselection: any | null = null;

  // remove missing
  for (const [id, obj] of current) {
    if (!items.some((c) => c.id === id)) {
      try {
        canvas.remove(obj);
      } catch {
        // ignore fabric internal remove race
      }
      current.delete(id);
    }
  }

  // ensure order and existence
  for (const c of items) {
    let obj = current.get(c.id);
    if (!obj) {
      if (c.type === "text") {
        obj = new IText((c as any).text || "", {
          left: c.x,
          top: c.y,
          fontFamily: (c as any).fontFamily || "Inter",
          fontSize: (c as any).fontSize || 24,
          fontWeight: (c as any).fontWeight || "normal",
          fontStyle: (c as any).italic ? "italic" : "",
          textAlign: (c as any).align || "left",
          fill: "#000",
        });
        obj.set({ scaleX: 1, scaleY: 1 });
      } else {
        const ic = c as ImageChild;
        if (ic.src) {
          obj = await Image.fromURL(ic.src, { crossOrigin: "anonymous" });
          obj.checkfuSrc = ic.src;
        } else {
          // placeholder X
          const baseW = 200,
            baseH = 150;
          const rect = new Rect({
            left: 0,
            top: 0,
            width: baseW,
            height: baseH,
            fill: "",
            stroke: "#94a3b8",
            strokeDashArray: [4, 3],
          });
          const l1 = new Line([0, 0, baseW, baseH], { stroke: "#cbd5e1" });
          const l2 = new Line([0, baseH, baseW, 0], { stroke: "#cbd5e1" });
          obj = new Group([rect, l1, l2], { left: c.x, top: c.y });
          (obj as any).checkfuPlaceholder = true;
        }
      }
      obj.checkfuId = c.id;
      obj.checkfuType = c.type;
      canvas.add(obj);
      if (activeId && c.id === activeId) reselection = obj;
    } else {
      // existing object: patch properties, including text/style/src
      if (c.type === "text") {
        const tc = c as TextChild;
        const nextFontStyle = tc.italic ? "italic" : "";
        // Only update expensive props if they changed
        if (
          obj.text !== (tc.text || "") ||
          obj.fontFamily !== (tc.fontFamily || "Inter") ||
          obj.fontSize !== (tc.fontSize || 24) ||
          obj.fontWeight !== (tc.fontWeight || "normal") ||
          obj.fontStyle !== nextFontStyle ||
          obj.textAlign !== (tc.align || "left")
        ) {
          obj.set({
            text: tc.text || "",
            fontFamily: tc.fontFamily || "Inter",
            fontSize: tc.fontSize || 24,
            fontWeight: tc.fontWeight || "normal",
            fontStyle: nextFontStyle,
            textAlign: tc.align || "left",
          });
          if (typeof obj.initDimensions === "function") obj.initDimensions();
          obj.set({ scaleX: 1, scaleY: 1 });
        }
      } else {
        const ic = c as ImageChild;
        const hasSrcChanged = ic.src && obj.checkfuSrc !== ic.src;
        const isPlaceholder = !!obj.checkfuPlaceholder;
        if (hasSrcChanged || (ic.src && isPlaceholder)) {
          // replace placeholder or refresh image with new src
          const objsAll = canvas.getObjects();
          const idx = objsAll.indexOf(obj);
          const newImg = await Image.fromURL(ic.src as string, {
            crossOrigin: "anonymous",
          });
          (newImg as any).checkfuId = c.id;
          (newImg as any).checkfuType = "image";
          (newImg as any).checkfuSrc = ic.src;
          // Add first, then try to reorder, then remove old object.
          try {
            canvas.add(newImg);
            if (typeof (newImg as any).moveTo === "function" && idx >= 0) {
              (newImg as any).moveTo(Math.max(0, idx));
            }
          } catch {}
          try {
            if (idx >= 0 && typeof canvas.remove === "function") {
              canvas.remove(obj);
            }
          } catch {
            // ignore remove errors on stale/unknown objects
          }
          obj = newImg;
          current.set(c.id, obj);
          if (activeId && c.id === activeId) reselection = obj;
        } else if (!ic.src && !isPlaceholder) {
          // State cleared src → ensure placeholder is shown
          const baseW = 200,
            baseH = 150;
          const rect = new Rect({
            left: 0,
            top: 0,
            width: baseW,
            height: baseH,
            fill: "",
            stroke: "#94a3b8",
            strokeDashArray: [4, 3],
          });
          const l1 = new Line([0, 0, baseW, baseH], { stroke: "#cbd5e1" });
          const l2 = new Line([0, baseH, baseW, 0], { stroke: "#cbd5e1" });
          const idx = canvas.getObjects().indexOf(obj);
          const placeholder: any = new Group([rect, l1, l2], {
            left: c.x,
            top: c.y,
          });
          placeholder.checkfuId = c.id;
          placeholder.checkfuType = "image";
          placeholder.checkfuSrc = undefined;
          placeholder.checkfuPlaceholder = true;
          try {
            canvas.add(placeholder);
            if (typeof placeholder.moveTo === "function" && idx >= 0) {
              placeholder.moveTo(Math.max(0, idx));
            }
          } catch {}
          try {
            canvas.remove(obj);
          } catch {}
          obj = placeholder;
          current.set(c.id, obj);
          if (activeId && c.id === activeId) reselection = obj;
        }
      }
    }
    // common positional/visibility props
    obj.set({
      left: c.x,
      top: c.y,
      angle: c.angle || 0,
      visible: c.visible ?? true,
      selectable: !(c.locked ?? false),
    });
    if (obj.checkfuType === "image") {
      if (obj.width && obj.height) {
        obj.set({ scaleX: c.width / obj.width, scaleY: c.height / obj.height });
      }
    } else {
      // text snaps to natural content size (scale 1)
      obj.set({ scaleX: 1, scaleY: 1 });
    }
    if (typeof obj.setCoords === "function") obj.setCoords();
  }

  // maintain z order by array index
  const objs = canvas.getObjects();
  items.forEach((c) => {
    const o = objs.find((oo: any) => oo.checkfuId === c.id);
    if (o && typeof canvas.bringObjectToFront === "function")
      canvas.bringObjectToFront(o);
  });
  if (reselection) {
    try {
      canvas.setActiveObject?.(reselection);
    } catch {}
  }
  canvas.requestRenderAll?.();
}
