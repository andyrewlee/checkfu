"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PageNode — React Flow node that renders a single printable page.
 *
 * Store‑driven mode (data.pageId) keeps the graph light: the node receives a
 * pageId and pulls live state from the domain store. All edits inside the
 * Fabric canvas push changes back via replaceChildren/selectChild.
 */

import { memo, useMemo, useState } from "react";
import type { Node as RFNode, NodeProps } from "@xyflow/react";
import { Handle, Position, NodeToolbar } from "@xyflow/react";
import PageCanvasFabric from "@/components/PageCanvasFabric";
import { usePageById, useActions } from "@/store/useEditorStore";
import { pagePx } from "@/lib/image/pageMetrics";

export type PageNodeData =
  | { pageId: string } // store-driven mode
  | ({
      id: string;
      title: string;
      orientation: "portrait" | "landscape";
      onBranch: (pageId: string) => void;
      onBranchWithPrompt?: (pageId: string, prompt: string) => void;
      onDelete?: (pageId: string) => void;
      onQuickGenerate?: (pageId: string) => void;
      imageUrl?: string;
      children: any[];
      onChildrenChange: (pageId: string, next: any[]) => void;
      onSelectChild: (pageId: string, childId: string | null) => void;
      onSetImageUrl?: (pageId: string, url: string) => void;
      loading?: boolean;
      loadingText?: string;
    } & Record<string, unknown>);

type PageRFNode = RFNode<PageNodeData, "page">;

function PageNode({ data, selected }: NodeProps<PageRFNode>) {
  const maybePageId = (data as any).pageId as string | undefined;
  const storeMode = !!maybePageId;
  const page = usePageById(maybePageId);
  const { selectChild, replaceChildren, setCurrentPage } = useActions();
  const [prompt, setPrompt] = useState("");
  const orientation = storeMode
    ? (page?.orientation ?? "portrait")
    : (data as any).orientation;
  const dims = useMemo(() => {
    const { pxW, pxH } = pagePx(orientation);
    return { w: pxW, h: pxH };
  }, [orientation]);

  return (
    <div
      className={`rounded-md border border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow ${
        selected ? "ring-2 ring-blue-500" : ""
      }`}
      style={{ width: dims.w + 16, padding: 8 }}
    >
      {/* Handles for connecting/branching (top target centered, bottom source centered). */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: "#94a3b8",
          left: "50%",
          transform: "translate(-50%, 0)",
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: "#94a3b8",
          left: "50%",
          transform: "translate(-50%, 0)",
        }}
      />

      <div
        className="flex items-center justify-between mb-2 select-none dragHandlePage"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            (data as any).onQuickGenerate?.(
              storeMode ? (maybePageId ?? "") : (data as any).id,
            );
          }
        }}
        title="Cmd/Ctrl+Click to quick-generate"
      >
        <div
          className="text-xs font-medium truncate"
          title={storeMode ? page?.title : (data as any).title}
        >
          {storeMode ? page?.title : (data as any).title}
        </div>
      </div>

      {/* Page canvas */}
      <div
        className="relative overflow-hidden bg-slate-50 border nodrag nopan nowheel"
        onMouseDown={(e) => {
          // Prevent React Flow from treating canvas clicks as node clicks
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{ width: dims.w, height: dims.h }}
      >
        <PageCanvasFabric
          pageId={storeMode ? (maybePageId ?? "") : (data as any).id}
          orientation={orientation}
          items={storeMode ? (page?.children ?? []) : (data as any).children}
          selectedChildId={storeMode ? (page?.selectedChildId ?? null) : null}
          suppressCommitSeq={(data as any).suppressCommitSeq || 0}
          removeChildId={(data as any).removeChildId || null}
          removeChildSeq={(data as any).removeChildSeq || 0}
          blockChildId={(data as any).blockChildId || null}
          blockChildSeq={(data as any).blockChildSeq || 0}
          onChildrenChange={(pid, next) => {
            if (storeMode) {
              replaceChildren(pid, next);
              (data as any).onChildrenChange?.(pid, next);
            } else (data as any).onChildrenChange?.(pid, next);
          }}
          onSelectChild={(pid, childId) => {
            if (storeMode) {
              // Ensure Inspector targets this page when selecting inside Fabric
              setCurrentPage(pid);
              selectChild(pid, childId);
              (data as any).onChildSelect?.(pid, childId);
            } else (data as any).onSelectChild?.(pid, childId);
          }}
          onCreateText={async ({ pageId, x, y, width, height }) =>
            (data as any).onCreateText?.({ pageId, x, y, width, height }) ??
            null
          }
          onCreateImage={async ({ pageId, x, y, width, height }) =>
            (data as any).onCreateImage?.({ pageId, x, y, width, height }) ??
            null
          }
        />
        {(storeMode ? page?.generating : (data as any).loading) ? (
          <div className="absolute inset-0 grid place-items-center bg-white/70 pointer-events-none select-none">
            <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-white shadow ring-1 ring-slate-300">
              <div className="h-5 w-5 rounded-full border-2 border-sky-600 border-t-transparent animate-spin" />
              <span className="text-sm font-semibold text-slate-900 tracking-wide">
                {(storeMode ? page?.status : (data as any).loadingText) ||
                  "Generating…"}
              </span>
            </div>
          </div>
        ) : null}

        {/* Portal toolbar (fixed) */}
        <NodeToolbar
          isVisible={selected}
          position={Position.Bottom}
          offset={8}
          nodeId={storeMode ? (maybePageId ?? "") : (data as any).id}
          className="nodrag nopan nowheel will-change-transform"
          style={{ pointerEvents: "all", zIndex: 1000 }}
        >
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
                if (e.key === "Enter") {
                  const p = prompt.trim();
                  if (!p) return;
                  (data as any).onBranchWithPrompt?.(
                    storeMode ? (maybePageId ?? "") : (data as any).id,
                    p,
                  );
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
                const p = prompt.trim();
                if (!p) return;
                (data as any).onBranchWithPrompt?.(
                  storeMode ? (maybePageId ?? "") : (data as any).id,
                  p,
                );
                setPrompt("");
              }}
            >
              Branch
            </button>
          </div>
        </NodeToolbar>
      </div>
    </div>
  );
}

export default memo(PageNode);
