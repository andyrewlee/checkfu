"use client";

/**
 * PagePreview
 * Lightweight, non-interactive preview of a printable page (US Letter).
 */

import { useMemo } from "react";
import { pagePx } from "@/lib/image/pageMetrics";
import Image from "next/image";

type Orientation = "portrait" | "landscape";

export default function PagePreview({
  orientation,
  imageUrl,
  ariaLabel,
}: {
  orientation: Orientation;
  imageUrl?: string;
  ariaLabel?: string;
}) {
  const dims = useMemo(() => {
    const { pxW, pxH } = pagePx(orientation);
    return { w: pxW, h: pxH };
  }, [orientation]);

  return (
    <div
      className="relative bg-white"
      style={{ width: dims.w, height: dims.h }}
      aria-label={ariaLabel || "Page preview"}
    >
      {/* Background */}
      <div className="absolute inset-0" />

      {/* Image area (full page, no enforced margins) */}
      <div
        className="absolute overflow-hidden relative"
        style={{ left: 1, top: 1, width: dims.w - 2, height: dims.h - 2 }}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt="Page image"
            fill
            sizes="100vw"
            style={{ objectFit: "contain" }}
            priority
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-slate-400 text-xs">
            No image yet
          </div>
        )}
      </div>

      {/* No safe margin overlay */}
    </div>
  );
}
