"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";
import Editor from "@/components/Editor";
import { useEditorStore } from "@/store/useEditorStore";
import { newId } from "@/lib/ids";

export default function DemoEditor() {
  const hasPages = useEditorStore((s) => s.order.length > 0);
  const actions = useEditorStore((s) => s.actions);
  const { openSignIn } = useClerk();

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
      <div className="absolute inset-x-0 top-0 z-10 grid place-items-center p-2 pointer-events-none">
        <button
          className="pointer-events-auto text-xs px-2 py-1 rounded bg-amber-100 text-amber-900 border border-amber-200 underline-offset-2"
          onClick={() => openSignIn?.({})}
        >
          Demo mode — changes here are not saved.{" "}
          <span className="underline">Sign in</span> to start your own.
        </button>
      </div>
      <Editor />
    </div>
  );
}
