"use client";

import { memo, useMemo } from "react";
import type { NodeProps } from "reactflow";
import WorksheetCanvas from "@/components/WorksheetCanvas";

const DPI = 96;

export type PageNodeData = {
  id: string;
  title: string;
  orientation: "portrait" | "landscape";
  marginInches: number;
  onBranch: (pageId: string) => void;
};

function PageNode({ data, selected }: NodeProps<PageNodeData>) {
  const scale = 0.25; // thumbnail scale for graph view
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
      style={{ width: dims.w * scale + 16, padding: 8 }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium truncate" title={data.title}>
          {data.title}
        </div>
        <button
          className="text-xs px-1.5 py-0.5 border rounded hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            data.onBranch(data.id);
          }}
          aria-label="Create variant"
          title="Create variant"
        >
          Branch
        </button>
      </div>
      <div
        className="relative overflow-hidden bg-slate-50 border"
        style={{ width: dims.w * scale, height: dims.h * scale }}
      >
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <WorksheetCanvas
            orientation={data.orientation}
            marginInches={data.marginInches}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(PageNode);

