"use client";

import { useState } from "react";
import WorksheetCanvas from "@/components/WorksheetCanvas";

type LeftTab = "templates" | "pages";
type Orientation = "portrait" | "landscape";

export default function EditorPage() {
  const [leftTab, setLeftTab] = useState<LeftTab>("templates");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [marginInches, setMarginInches] = useState<number>(0.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    // Start panning with middle mouse, right mouse, or space+left
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPanning(true);
      setLastPos({ x: e.clientX, y: e.clientY });
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning || !lastPos) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    setLastPos({ x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!panning) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setPanning(false);
    setLastPos(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    // Zoom if Ctrl/Cmd is held (pinch gesture), otherwise ignore
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY; // natural: scroll up to zoom in
      const factor = Math.exp(delta * 0.0015); // smooth exponential zoom
      setZoom((z) => clamp(z * factor, 0.25, 3));
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " ") {
      setSpaceDown(true);
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      setZoom((z) => clamp(z * 1.1, 0.25, 3));
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "-") {
      e.preventDefault();
      setZoom((z) => clamp(z / 1.1, 0.25, 3));
    }
    if (e.key.toLowerCase() === "0" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") setSpaceDown(false);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header
        className="h-14 px-4 border-b bg-background flex items-center justify-between"
        role="toolbar"
        aria-label="Editor top bar"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold">Checkfu</span>
          <span className="text-sm text-muted-foreground">Editor</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-md border text-sm"
            aria-label="Export"
            onClick={() => alert("Export stub — wired later")}
          >
            Export
          </button>
          <button
            className="px-3 py-1.5 rounded-md border text-sm"
            aria-label="Settings"
            onClick={() => alert("Settings stub — wired later")}
          >
            Settings
          </button>
        </div>
      </header>

      {/* Main grid: left sidebar, canvas column, right inspector */}
      <div className="h-[calc(100vh-56px-28px)] grid" style={{ gridTemplateColumns: "260px 1fr 320px" }}>
        {/* Left sidebar */}
        <aside
          className="border-r bg-background flex flex-col"
          role="complementary"
          aria-label="Left sidebar"
        >
          <div className="p-2 border-b flex gap-2" role="tablist" aria-label="Left panels">
            <button
              role="tab"
              aria-selected={leftTab === "templates"}
              className={`px-2 py-1 text-sm rounded-md border ${leftTab === "templates" ? "bg-accent" : "bg-background"}`}
              onClick={() => setLeftTab("templates")}
            >
              Templates
            </button>
            <button
              role="tab"
              aria-selected={leftTab === "pages"}
              className={`px-2 py-1 text-sm rounded-md border ${leftTab === "pages" ? "bg-accent" : "bg-background"}`}
              onClick={() => setLeftTab("pages")}
            >
              Pages
            </button>
          </div>
          <div className="p-3 overflow-auto grow" role="tabpanel">
            {leftTab === "templates" ? (
              <div className="text-sm space-y-2">
                <p className="text-muted-foreground">Template stubs</p>
                <ul className="list-disc list-inside">
                  <li>Ten frame</li>
                  <li>Dot cards</li>
                  <li>Make ten</li>
                  <li>Number line</li>
                </ul>
              </div>
            ) : (
              <div className="text-sm space-y-2">
                <p className="text-muted-foreground">Pages list stub</p>
                <ul className="space-y-1">
                  <li>
                    <button className="w-full text-left px-2 py-1 rounded hover:bg-accent">
                      Page 1
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </aside>

        {/* Canvas column (infinite stage) */}
        <main
          className="bg-muted/20 overflow-hidden"
          aria-label="Canvas area"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          tabIndex={0}
        >
          <div className="w-full h-full relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="will-change-transform"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                }}
              >
                <WorksheetCanvas orientation={orientation} marginInches={marginInches} />
              </div>
            </div>
          </div>
        </main>

        {/* Inspector */}
        <aside
          className="border-l bg-background p-3 overflow-auto"
          role="complementary"
          aria-label="Inspector"
        >
          <div className="space-y-3">
            <h2 className="font-semibold">Inspector</h2>
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Page</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <label className="col-span-1">Orientation</label>
                <div className="col-span-1 flex gap-1">
                  <button
                    className={`px-2 py-1 border rounded ${orientation === "portrait" ? "bg-accent" : ""}`}
                    aria-pressed={orientation === "portrait"}
                    onClick={() => setOrientation("portrait")}
                  >
                    Portrait
                  </button>
                  <button
                    className={`px-2 py-1 border rounded ${orientation === "landscape" ? "bg-accent" : ""}`}
                    aria-pressed={orientation === "landscape"}
                    onClick={() => setOrientation("landscape")}
                  >
                    Landscape
                  </button>
                </div>
                <label className="col-span-1">Margin</label>
                <div className="col-span-1 flex gap-1">
                  <button
                    className={`px-2 py-1 border rounded ${marginInches === 0.5 ? "bg-accent" : ""}`}
                    aria-pressed={marginInches === 0.5}
                    onClick={() => setMarginInches(0.5)}
                  >
                    0.5 in
                  </button>
                  <button
                    className={`px-2 py-1 border rounded ${marginInches === 1 ? "bg-accent" : ""}`}
                    aria-pressed={marginInches === 1}
                    onClick={() => setMarginInches(1)}
                  >
                    1 in
                  </button>
                </div>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-medium text-muted-foreground">Standards</h3>
              <p className="text-sm text-muted-foreground">Picker stub</p>
            </section>
          </div>
        </aside>
      </div>

      {/* Status strip */}
      <footer
        className="h-7 px-3 border-t bg-background text-xs flex items-center justify-between"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              className="px-1.5 py-0.5 border rounded"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => clamp(z / 1.1, 0.25, 3))}
            >
              −
            </button>
            <button
              className="px-2 py-0.5 border rounded"
              aria-label="Reset zoom"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="px-1.5 py-0.5 border rounded"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => clamp(z * 1.1, 0.25, 3))}
            >
              +
            </button>
          </div>
          <span>Standards: none</span>
        </div>
        <div className="text-muted-foreground">
          Images may be AI generated and include a SynthID watermark
        </div>
      </footer>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
