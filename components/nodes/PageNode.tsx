"use client";

import { memo, useMemo, useRef } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";
import WorksheetCanvas from "@/components/WorksheetCanvas";
import FabricPage from "@/components/FabricPage";

const DPI = 96;

export type PageNodeData = {
  id: string;
  title: string;
  orientation: "portrait" | "landscape";
  marginInches: number;
  onBranch: (pageId: string) => void;
  onDropText: (pageId: string, x: number, y: number) => void;
  texts: { id: string; x: number; y: number; content: string }[];
  onTextsChange?: (pageId: string, texts: { id: string; x: number; y: number; content: string }[]) => void;
};

function PageNode({ data, selected }: NodeProps<PageNodeData>) {
  const stop = (e: any) => e.stopPropagation();
  const scale = 0.25; // thumbnail scale for graph view
  const dims = useMemo(() => {
    const wIn = data.orientation === "portrait" ? 8.5 : 11;
    const hIn = data.orientation === "portrait" ? 11 : 8.5;
    return { w: Math.round(wIn * DPI), h: Math.round(hIn * DPI) };
  }, [data.orientation]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const kind = e.dataTransfer.getData("application/checkfu") || e.dataTransfer.getData("text/plain");
    if (kind !== "text") return;
    const rect = (containerRef.current as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    data.onDropText(data.id, Math.round(x), Math.round(y));
  };

  return (
    <div
      className={`rounded-md border bg-white/95 backdrop-blur-sm shadow-sm ${
        selected ? "ring-2 ring-blue-500" : ""
      }`}
      style={{ width: dims.w * scale + 16, padding: 8 }}
    >
      {/* Handles for connecting/branching (top target, bottom source) */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#64748b", left: "50%", transform: "translate(-50%, 0)" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#64748b", left: "50%", transform: "translate(-50%, 0)" }}
      />

      <div className="flex items-center justify-between mb-2 rf-node-drag">
        <div className="text-xs font-medium truncate" title={data.title}>
          {data.title}
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-slate-50 border"
        style={{ width: dims.w * scale, height: dims.h * scale }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        title="Drop a Text item here"
      >
        <FabricPage
          orientation={data.orientation}
          marginInches={data.marginInches}
          texts={data.texts}
          onTextsChange={(next) => data.onTextsChange?.(data.id, next)}
          scale={scale}
          onDropText={(x, y) => data.onDropText(data.id, x, y)}
        />
        {/* Always-visible overlay of text from state for immediate feedback */}
        <div
          className="absolute left-0 top-0 pointer-events-none z-10"
          style={{
            width: dims.w,
            height: dims.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {data.texts?.map((t) => (
            <div key={t.id} className="absolute" style={{ left: t.x, top: t.y }}>
              <span style={{ fontSize: 16, color: "#111" }}>{t.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(PageNode);
