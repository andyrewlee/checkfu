"use client";

import { useEffect } from "react";
import { useEvent } from "@/hooks/useEvent";

export function useDropAndPasteImport<T extends HTMLElement>(
  targetRef: React.RefObject<T | null>,
  onImportImage: (url: string, title?: string) => void,
  onError?: (msg: string) => void,
) {
  const importLatest = useEvent(onImportImage);
  const errorLatest = useEvent(onError ?? (() => {}));

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files || []);
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          importLatest(URL.createObjectURL(file), file.name);
        }
      }
      if (files.length) return;
      const urlText =
        e.dataTransfer.getData("text/uri-list") ||
        e.dataTransfer.getData("text/plain");
      if (urlText && /^https?:\/\//i.test(urlText)) {
        try {
          const resp = await fetch(urlText);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            importLatest(URL.createObjectURL(blob), "Dropped URL image");
          }
        } catch {
          errorLatest("Failed to fetch dropped URL");
        }
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      const imgItem = items.find((it) => it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (!file) return;
        importLatest(URL.createObjectURL(file), "Pasted image");
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text && /^https?:\/\//i.test(text)) {
        try {
          const resp = await fetch(text);
          const blob = await resp.blob();
          if (blob.type.startsWith("image/")) {
            importLatest(URL.createObjectURL(blob), "Pasted URL image");
          }
        } catch {
          errorLatest("Failed to fetch pasted URL");
        }
      }
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [targetRef, importLatest, errorLatest]);
}
