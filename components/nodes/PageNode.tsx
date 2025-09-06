"use client";

// PageNode: React Flow node that displays a single printable page.
// - Header shows title and action buttons (branch, delete)
// - Body renders a print-accurate page preview (8.5×11 with margins)
// - Bottom circular "+" provides a clear branching affordance

import { memo, useMemo, useState } from "react";
import type { Node as RFNode, NodeProps } from "@xyflow/react";
import { Handle, Position, NodeToolbar } from "@xyflow/react";
import PagePreview from "@/components/PagePreview";

const DPI = 96;

export type PageNodeData = {
  id: string;
  title: string;
  orientation: "portrait" | "landscape";
  marginInches: number;
  onBranch: (pageId: string) => void;
  onBranchWithPrompt?: (pageId: string, prompt: string) => void;
  onDelete?: (pageId: string) => void;
  onQuickGenerate?: (pageId: string) => void;
  imageUrl?: string;
  onSetImageUrl?: (pageId: string, url: string) => void;
  // Visual status
  loading?: boolean;
  loadingText?: string;
};

type PageRFNode = RFNode<PageNodeData, 'page'>;

function PageNode({ data, selected }: NodeProps<PageRFNode>) {
  const [prompt, setPrompt] = useState("");
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
      {/* Handles for connecting/branching (top target centered, bottom source centered). */}
      <Handle type="target" position={Position.Top} style={{ background: "#64748b", left: "50%", transform: "translate(-50%, 0)" }} />
      <Handle type="source" position={Position.Bottom} style={{ background: "#64748b", left: "50%", transform: "translate(-50%, 0)" }} />

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
        <div className="text-xs font-medium truncate" title={data.title}>
          {data.title}
        </div>
        {/* Action buttons removed per spec; NodeToolbar used for branching */}
      </div>

      {/* Page preview only (no direct interaction on node) */}
      <div className="relative overflow-hidden bg-slate-50 border" style={{ width: dims.w, height: dims.h }}>
        <PagePreview orientation={data.orientation} marginInches={data.marginInches} imageUrl={data.imageUrl} />
        {data.loading ? (
          <div className="absolute inset-0 grid place-items-center bg-white/40 pointer-events-none select-none">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
              <span>{data.loadingText || 'Generating…'}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* NodeToolbar for branching: prompt input + action */}
      <NodeToolbar isVisible={selected} position={Position.Bottom} className="nodrag nopan nowheel" style={{ pointerEvents: 'all', zIndex: 1000 }}>
        <div className="flex items-center gap-2 bg-white/95 border rounded shadow-sm px-2 py-1">
          <input
            type="text"
            placeholder="Describe the change…"
            className="border rounded px-2 py-1 text-xs w-64 nodrag nopan nowheel"
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                const p = prompt.trim(); if (!p) return;
                data.onBranchWithPrompt?.(data.id, p);
                setPrompt("");
              }
            }}
          />
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const p = prompt.trim(); if (!p) return;
              data.onBranchWithPrompt?.(data.id, p);
              setPrompt("");
            }}
          >
            Branch
          </button>
        </div>
      </NodeToolbar>
    </div>
  );
}

export default memo(PageNode);
