"use client";

import type { TextChild, ImageChild } from "@/store/useEditorStore";

export default function LayersPanel(props: {
  items: (TextChild | ImageChild)[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onDelete: (id: string) => void;
}) {
  const {
    items,
    selectedId,
    onSelect,
    onToggleVisible,
    onToggleLocked,
    onMove,
    onDelete,
  } = props;
  const reversed = [...items].map((it, idx) => ({ it, idx })).reverse(); // top-most first
  return (
    <div className="mt-2 border rounded bg-white divide-y">
      {reversed.length === 0 ? (
        <div className="text-xs text-slate-500 px-2 py-3">No layers yet</div>
      ) : (
        reversed.map(({ it }) => {
          const id = it.id;
          const isSelected = id === selectedId;
          const label =
            it.type === "text"
              ? `Text: ${(it as TextChild).text?.slice(0, 24) || ""}`
              : "Image";
          const visible = it.visible ?? true;
          const locked = it.locked ?? false;
          return (
            <div
              key={id}
              className={`flex items-center gap-2 px-2 py-1 text-xs ${isSelected ? "bg-blue-50" : ""}`}
            >
              <button
                className={`h-5 w-5 grid place-items-center rounded ${visible ? "text-slate-700" : "text-slate-400"}`}
                title={visible ? "Hide" : "Show"}
                onClick={() => onToggleVisible(id)}
              >
                {visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                className={`h-5 w-5 grid place-items-center rounded ${locked ? "text-slate-700" : "text-slate-400"}`}
                title={locked ? "Unlock" : "Lock"}
                onClick={() => onToggleLocked(id)}
              >
                {locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <button
                className="flex-1 text-left truncate"
                onClick={() => onSelect(id)}
                title={label}
              >
                {label}
              </button>
              <button
                className="h-5 w-5 grid place-items-center text-slate-600"
                title="Move up"
                onClick={() => onMove(id, "up")}
              >
                <UpIcon />
              </button>
              <button
                className="h-5 w-5 grid place-items-center text-slate-600"
                title="Move down"
                onClick={() => onMove(id, "down")}
              >
                <DownIcon />
              </button>
              <button
                className="h-5 w-5 grid place-items-center text-red-600"
                title="Delete"
                onClick={() => onDelete(id)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-6.94"></path>
      <path d="M1 1l22 22"></path>
      <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88"></path>
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function UnlockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.5-2" />
    </svg>
  );
}
function UpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}
function DownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
