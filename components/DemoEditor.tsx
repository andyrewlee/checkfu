"use client";

import { useLayoutEffect, useState } from "react";
import Editor from "@/components/Editor";
import { useEditorStore, clearHistory } from "@/store/useEditorStore";
import { newId } from "@/lib/ids";

export default function DemoEditor() {
  const actions = useEditorStore((s) => s.actions);
  const [ready, setReady] = useState(false);

  // Bootstrap demo after mount: reset store, then seed one demo page
  useLayoutEffect(() => {
    try {
      // Clear undo history and state before seeding demo
      try {
        clearHistory();
      } catch {}
      actions.resetAll();
      const id = newId("p");
      actions.addEmptyPage({
        id,
        title: "Untitled Page",
        orientation: "portrait",
        pageType: "coloring",
      });
    } finally {
      setReady(true);
    }
  }, [actions]);

  if (!ready) return null;
  return <Editor />;
}
