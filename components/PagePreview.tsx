"use client";

/**
 * PagePreview
 * Lightweight, non-interactive preview of a printable page (US Letter).
 */

import { useMemo } from "react";
import Image from "next/image";

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
        className="absolute overflow-hidden relative"
        style={{
          left: m + 1,
          top: m + 1,
          width: Math.max(0, dims.w - 2 * m - 2),
          height: Math.max(0, dims.h - 2 * m - 2),
        }}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt="Page image"
            fill
            sizes="100vw"
            style={{ objectFit: 'contain' }}
            priority
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
