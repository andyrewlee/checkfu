"use client";

import { useEffect } from "react";
import Editor from "@/components/Editor";
import { useEditorStore } from "@/store/useEditorStore";
import { newId } from "@/lib/ids";

export default function DemoEditor() {
  const hasPages = useEditorStore((s) => s.order.length > 0);
  const actions = useEditorStore((s) => s.actions);

  useEffect(() => {
    if (hasPages) return;
    const id = newId("p");
    actions.addEmptyPage({
      id,
      title: "Featured Demo",
      orientation: "portrait",
      imageUrl: "/product.png",
      originalImageUrl: "/product.png",
      pageType: "coloring",
    });
  }, [hasPages, actions]);

  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-0 z-10 grid place-items-center p-2">
        <div className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900 border border-amber-200">
          Demo mode — changes here are not saved. Sign in to start your own.
        </div>
      </div>
      <Editor />
    </div>
  );
}
