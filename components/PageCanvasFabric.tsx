"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef } from "react";
import type { TextChild, ImageChild } from "@/store/useEditorStore";

type Props = {
  pageId: string;
  orientation: "portrait" | "landscape";
  items: (TextChild | ImageChild)[];
  selectedChildId: string | null;
  onChildrenChange: (pageId: string, next: (TextChild | ImageChild)[]) => void;
  onSelectChild: (pageId: string, childId: string | null) => void;
};

const DPI = 96;

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

  const dims = useMemo(() => {
    const wIn = orientation === "portrait" ? 8.5 : 11;
    const hIn = orientation === "portrait" ? 11 : 8.5;
    return { w: Math.round(wIn * DPI), h: Math.round(hIn * DPI) };
  }, [orientation]);

  // initialize Fabric (guarded for Strict Mode double-invoke)
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

      const isEqualState = (
        a: (TextChild | ImageChild)[],
        b: (TextChild | ImageChild)[],
      ) => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          const x = a[i] as any;
          const y = b[i] as any;
          if (x.id !== y.id || x.type !== y.type) return false;
          const keys = [
            "x",
            "y",
            "width",
            "height",
            "angle",
            "visible",
            "locked",
          ];
          for (const k of keys)
            if ((x as any)[k] !== (y as any)[k]) return false;
          if (x.type === "text") {
            const tks = [
              "text",
              "fontFamily",
              "fontSize",
              "fontWeight",
              "italic",
              "align",
            ];
            for (const k of tks)
              if ((x as any)[k] !== (y as any)[k]) return false;
          } else if (x.type === "image") {
            if (x.src !== y.src) return false;
          }
        }
        return true;
      };

      const commit = () => {
        // Convert any text scaling into font size and snap to content bounds
        canvas.getObjects().forEach(normalizeTextScaling);
        const next = canvas.getObjects().map((obj: any) => {
          const base = {
            id: obj.checkfuId as string,
            type: obj.checkfuType as "text" | "image",
            x: obj.left ?? 0,
            y: obj.top ?? 0,
            width: (obj.width || 1) * (obj.scaleX || 1),
            height: (obj.height || 1) * (obj.scaleY || 1),
            angle: obj.angle ?? 0,
            visible: obj.visible ?? true,
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
              src: obj.checkfuSrc as string,
              crop: null,
            } as ImageChild;
          }
        });
        // Skip commit if nothing actually changed to avoid stale overwrites
        if (!isEqualState(next, items)) {
          // Defer state commit to the next frame to avoid UI flicker on selection clear
          requestAnimationFrame(() => onChildrenChange(pageId, next));
        }
        canvas.requestRenderAll();
      };
      canvas.on("object:modified", commit);
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

      // initial paint
      await hydrate(canvas, items);
      canvas.requestRenderAll();
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

  // sync objects from state
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    hydrate(canvas, items).then(() => canvas.requestRenderAll());
  }, [items]);

  // programmatic selection from store (also re-hydrate to guarantee latest text)
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const id = selectedChildId ?? null;
    if (!id) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }
    // Ensure canvas objects mirror latest store state before selecting
    hydrate(canvas, items).then(() => {
      const target = canvas.getObjects().find((o: any) => o.checkfuId === id);
      if (target) {
        canvas.setActiveObject(target);
        if (typeof (target as any).setCoords === "function")
          (target as any).setCoords();
        canvas.requestRenderAll();
      }
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
}
