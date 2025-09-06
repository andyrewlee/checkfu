"use client";

import { useEffect, useMemo, useRef } from "react";

type Orientation = "portrait" | "landscape";

export function WorksheetCanvas({
  orientation,
  marginInches,
}: {
  orientation: Orientation;
  marginInches: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const DPI = 96; // screen reference DPI for layout
  const dims = useMemo(() => {
    const wIn = orientation === "portrait" ? 8.5 : 11;
    const hIn = orientation === "portrait" ? 11 : 8.5;
    const w = Math.round(wIn * DPI);
    const h = Math.round(hIn * DPI);
    return { w, h };
  }, [orientation]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    // Ensure crisp rendering on high-DPI displays
    el.width = dims.w * dpr;
    el.height = dims.h * dpr;
    el.style.width = `${dims.w}px`;
    el.style.height = `${dims.h}px`;

    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dims.w, dims.h);
    ctx.restore();

    // Safe margin overlay (dashed)
    const m = Math.round(marginInches * DPI);
    const x = m;
    const y = m;
    const w = dims.w - m * 2;
    const h = dims.h - m * 2;
    ctx.save();
    ctx.strokeStyle = "#cbd5e1"; // slate-300
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    ctx.restore();

    // Label
    ctx.save();
    ctx.fillStyle = "#64748b"; // slate-500
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(
      `Letter 8.5in × 11in — margin ${marginInches}\" (${orientation})`,
      8,
      Math.max(16, dims.h - 8)
    );
    ctx.restore();
  }, [dims.w, dims.h, marginInches, orientation, DPI]);

  return (
    <canvas
      ref={canvasRef}
      className="bg-white shadow-sm border"
      aria-label="Worksheet letter canvas"
    />
  );
}

export default WorksheetCanvas;
