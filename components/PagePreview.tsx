"use client";

// PagePreview: lightweight preview of a printable page.
// - Renders a fixed 8.5×11 canvas in CSS pixels (96 DPI reference)
// - Shows dashed safe margins and fits the page image with object-contain
// - Non-interactive: this is a WYSIWYG preview for printing/export

import { useMemo } from "react";

type Orientation = "portrait" | "landscape";

export default function PagePreview({
  orientation,
  marginInches,
  imageUrl,
  ariaLabel,
}: {
  orientation: Orientation;
  marginInches: number;
  imageUrl?: string;
  ariaLabel?: string;
}) {
  const DPI = 96;
  const dims = useMemo(() => {
    const wIn = orientation === "portrait" ? 8.5 : 11;
    const hIn = orientation === "portrait" ? 11 : 8.5;
    return { w: Math.round(wIn * DPI), h: Math.round(hIn * DPI) };
  }, [orientation]);

  const m = Math.round(marginInches * DPI);

  return (
    <div
      className="relative bg-white"
      style={{ width: dims.w, height: dims.h }}
      aria-label={ariaLabel || "Page preview"}
    >
      {/* Background */}
      <div className="absolute inset-0" />

      {/* Inner margin area */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: m + 1,
          top: m + 1,
          width: Math.max(0, dims.w - 2 * m - 2),
          height: Math.max(0, dims.h - 2 * m - 2),
        }}
      >
        {imageUrl ? (
          // Use object-fit contain to keep aspect and fit inside margins
          <img
            src={imageUrl}
            alt="Page image"
            className="w-full h-full object-contain pointer-events-none select-none"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-400 text-xs">
            No image yet
          </div>
        )}
      </div>

      {/* Safe margin dashed rectangle */}
      <div
        className="absolute border border-dashed border-slate-300/70 pointer-events-none"
        style={{
          left: m + 1,
          top: m + 1,
          width: Math.max(0, dims.w - 2 * m - 2),
          height: Math.max(0, dims.h - 2 * m - 2),
        }}
        aria-hidden
      />
    </div>
  );
}
