"use client";

// PageNode: React Flow node that displays a single printable page.
// - Header shows title and action buttons (branch, delete)
// - Body renders a print-accurate page preview (8.5×11 with margins)
// - Bottom circular "+" provides a clear branching affordance

import { memo, useMemo } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";
import PagePreview from "@/components/PagePreview";

const DPI = 96;

export type PageNodeData = {
  id: string;
  title: string;
  orientation: "portrait" | "landscape";
  marginInches: number;
  onBranch: (pageId: string) => void;
  onDelete?: (pageId: string) => void;
  onQuickGenerate?: (pageId: string) => void;
  imageUrl?: string;
  onSetImageUrl?: (pageId: string, url: string) => void;
  // Inpainting overlay controls (provided by parent editor)
  painting?: boolean;
  inpaintBrush?: number;
  inpaintEraser?: boolean;
  onRegisterMaskCanvas?: (pageId: string, el: HTMLCanvasElement | null) => void;
};

function PageNode({ data, selected }: NodeProps<PageNodeData>) {
  const dims = useMemo(() => {
    const wIn = data.orientation === "portrait" ? 8.5 : 11;
    const hIn = data.orientation === "portrait" ? 11 : 8.5;
    return { w: Math.round(wIn * DPI), h: Math.round(hIn * DPI) };
  }, [data.orientation]);

  return (
    <div
      className={`rounded-md border bg-white/95 backdrop-blur-sm shadow-sm ${
        selected ? "ring-2 ring-blue-500" : ""
      }`}
      style={{ width: dims.w + 16, padding: 8 }}
    >
      {/* Handles for connecting/branching (top target, bottom source). Move bottom away from center so it doesn't overlap the branch circle. */}
      <Handle type="target" position={Position.Top} style={{ background: "#64748b", left: "50%", transform: "translate(-50%, 0)" }} />
      <Handle type="source" position={Position.Bottom} style={{ background: "#64748b", left: "15%" }} />

      <div
        className="flex items-center justify-between mb-2 select-none"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            data.onQuickGenerate?.(data.id);
          }
        }}
        title="Cmd/Ctrl+Click to quick-generate"
      >
        {/* Only the title acts as the drag handle to avoid capturing button clicks */}
        <div className="text-xs font-medium truncate rf-node-drag" title={data.title}>
          {data.title}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Refine (branch)"
            title="Refine (branch)"
            className="nodrag nopan text-xs px-1.5 py-0.5 rounded border hover:scale-105 transition"
            style={{ position: 'relative', zIndex: 50 }}
            onClick={(e) => {
              e.stopPropagation();
              data.onBranch(data.id);
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Delete node"
            title="Delete node"
            className="nodrag nopan text-xs px-1.5 py-0.5 rounded border hover:scale-105 transition"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete?.(data.id);
            }}
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Page preview + optional inpainting overlay */}
      <div className="relative overflow-hidden bg-slate-50 border" style={{ width: dims.w, height: dims.h }}>
        <PagePreview orientation={data.orientation} marginInches={data.marginInches} imageUrl={data.imageUrl} />
        {data.painting ? (
          <MaskOverlay
            pageId={data.id}
            width={dims.w}
            height={dims.h}
            brush={Math.max(2, data.inpaintBrush ?? 24)}
            eraser={!!data.inpaintEraser}
            onRegister={data.onRegisterMaskCanvas}
          />
        ) : null}
      </div>

      {/* Branch circle under the page */}
      <div className="w-full flex justify-center mt-2">
        <button
          type="button"
          aria-label="Branch from this page"
          title="Branch (refine)"
          className="nodrag nopan w-8 h-8 rounded-full border bg-white hover:bg-slate-50 hover:scale-105 transition"
          style={{ position: 'relative', zIndex: 50 }}
          onClick={(e) => { e.stopPropagation(); data.onBranch(data.id); }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default memo(PageNode);

function MaskOverlay({
  pageId,
  width,
  height,
  brush,
  eraser,
  onRegister,
}: {
  pageId: string;
  width: number;
  height: number;
  brush: number;
  eraser: boolean;
  onRegister?: (pageId: string, el: HTMLCanvasElement | null) => void;
}) {
  const handleRef = (el: HTMLCanvasElement | null) => {
    if (onRegister) onRegister(pageId, el);
  };
  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if ((e.buttons & 1) !== 1) return; // only draw with primary button held
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.45)';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, brush / 2), 0, Math.PI * 2); ctx.fill();
  }
  return (
    <canvas
      ref={handleRef}
      width={width}
      height={height}
      className="absolute inset-0"
      style={{ cursor: eraser ? 'cell' : 'crosshair' }}
      onMouseDown={draw}
      onMouseMove={draw}
    />
  );
}
