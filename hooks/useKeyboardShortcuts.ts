"use client";

import { useEffect } from "react";
import { useEvent } from "@/hooks/useEvent";

export function useKeyboardShortcuts(opts: {
  onQuickGenerate: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const onQuick = useEvent(opts.onQuickGenerate);
  const onDelete = useEvent(opts.onDeleteSelected);
  const onUndo = useEvent(opts.onUndo);
  const onRedo = useEvent(opts.onRedo);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const editing = !!(
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      );
      if (!editing && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onQuick();
      } else if (!editing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        onDelete();
      } else if (
        !editing &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      } else if (
        !editing &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "y"
      ) {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onQuick, onDelete, onUndo, onRedo]);
}
