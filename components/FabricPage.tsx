"use client";

import { useEffect, useRef } from "react";
import { fabric } from "fabric";

type Orientation = "portrait" | "landscape";

export type FabricText = { id: string; x: number; y: number; content: string };

export default function FabricPage({
  orientation,
  marginInches,
  texts,
  onTextsChange,
  scale,
  onDropText,
}: {
  orientation: Orientation;
  marginInches: number;
  texts: FabricText[];
  onTextsChange: (next: FabricText[]) => void;
  scale: number; // viewport zoom (e.g., 0.25)
  onDropText?: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const marginRef = useRef<fabric.Rect | null>(null);
  const textMapRef = useRef<Map<string, fabric.Textbox>>(new Map());

  const DPI = 96;
  const width = Math.round((orientation === "portrait" ? 8.5 : 11) * DPI);
  const height = Math.round((orientation === "portrait" ? 11 : 8.5) * DPI);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const canvas = new fabric.Canvas(el, {
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Base dimensions and zoom
    canvas.setWidth(width);
    canvas.setHeight(height);
    canvas.setZoom(scale);
    // Set CSS size to match zoom for crisp pointer mapping
    el.style.width = `${width * scale}px`;
    el.style.height = `${height * scale}px`;
    // Background
    canvas.setBackgroundColor("white", () => canvas.requestRenderAll());
    // Margin rectangle
    const m = Math.round(marginInches * DPI);
    const rect = new fabric.Rect({
      left: m + 1,
      top: m + 1,
      width: Math.max(0, width - 2 * m - 2),
      height: Math.max(0, height - 2 * m - 2),
      fill: "",
      stroke: "#cbd5e1",
      strokeDashArray: [6, 6],
      strokeWidth: 2,
      selectable: false,
      evented: false,
      excludeFromExport: false,
    });
    marginRef.current = rect;
    canvas.add(rect);

    const updateFromCanvas = () => {
      const items: FabricText[] = [];
      canvas.getObjects().forEach((obj) => {
        if (obj.type === "textbox") {
          const tb = obj as fabric.Textbox & { elId?: string };
          const id = tb.elId || (tb as any).elId || "";
          items.push({ id, x: Math.round(tb.left || 0), y: Math.round(tb.top || 0), content: tb.text || "" });
        }
      });
      onTextsChange(items);
    };

    const handleModified = () => updateFromCanvas();
    const handleChanged = () => updateFromCanvas();
    canvas.on("object:modified", handleModified);
    canvas.on("text:changed", handleChanged);

    return () => {
      canvas.off("object:modified", handleModified);
      canvas.off("text:changed", handleChanged);
      canvas.dispose();
      fabricRef.current = null;
      textMapRef.current.clear();
    };
  }, []);

  // Sync zoom when scale changes
  useEffect(() => {
    const canvas = fabricRef.current;
    const el = canvasRef.current;
    if (!canvas || !el) return;
    canvas.setZoom(scale);
    el.style.width = `${width * scale}px`;
    el.style.height = `${height * scale}px`;
    // Keep text readable at thumbnail scale by inverting the zoom for font size
    const baseFont = Math.max(12, Math.round(16 / scale));
    textMapRef.current.forEach((tb) => {
      tb.set({ fontSize: baseFont });
    });
    canvas.requestRenderAll();
  }, [scale, width, height]);

  // Sync margin rectangle and size on orientation/margin change
  useEffect(() => {
    const canvas = fabricRef.current;
    const rect = marginRef.current;
    const el = canvasRef.current;
    if (!canvas || !rect || !el) return;
    canvas.setWidth(width);
    canvas.setHeight(height);
    const m = Math.round(marginInches * DPI);
    rect.set({
      left: m + 1,
      top: m + 1,
      width: Math.max(0, width - 2 * m - 2),
      height: Math.max(0, height - 2 * m - 2),
    });
    canvas.requestRenderAll();
  }, [orientation, marginInches, width, height]);

  // Sync Fabric textboxes from props
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const map = textMapRef.current;
    const nextIds = new Set(texts.map((t) => t.id));
    const baseFont = Math.max(12, Math.round(16 / scale));

    // Remove deleted
    for (const [id, obj] of Array.from(map.entries())) {
      if (!nextIds.has(id)) {
        canvas.remove(obj);
        map.delete(id);
      }
    }

    // Upsert existing
    texts.forEach((t) => {
      const existing = map.get(t.id);
      if (existing) {
        existing.set({ left: t.x, top: t.y, text: t.content, fontSize: baseFont });
        existing.setCoords();
      } else {
        const tb = new fabric.Textbox(t.content || "Text", {
          left: t.x,
          top: t.y,
          fontSize: baseFont,
          fill: "#111",
          width: 300,
          editable: true,
        }) as fabric.Textbox & { elId?: string };
        tb.elId = t.id;
        map.set(t.id, tb);
        canvas.add(tb);
      }
    });
    canvas.requestRenderAll();
  }, [texts]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const kind = e.dataTransfer.getData("application/checkfu") || e.dataTransfer.getData("text/plain");
    if (kind !== "text") return;
    const rect = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    onDropText?.(Math.round(x), Math.round(y));
  };

  return (
    <div onPointerDown={(e) => e.stopPropagation()} onDragOver={handleDragOver} onDrop={handleDrop}>
      <canvas ref={canvasRef} />
    </div>
  );
}
