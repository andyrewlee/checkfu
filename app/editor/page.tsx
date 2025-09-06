"use client";

import { useState } from "react";

type LeftTab = "templates" | "pages";

export default function EditorPage() {
  const [leftTab, setLeftTab] = useState<LeftTab>("templates");

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

        {/* Canvas column */}
        <main className="bg-muted/20 flex items-center justify-center overflow-auto" aria-label="Canvas area">
          {/* Letter canvas placeholder (portrait) */}
          <div className="relative bg-white shadow-sm border" style={{ width: 816, height: 1056 }}>
            {/* Safe margin overlay: 0.5in default */}
            <div
              className="absolute inset-0 pointer-events-none"
              aria-hidden
            >
              <div className="absolute inset-0 m-12 border-2 border-dashed border-slate-300" />
            </div>
            <div className="absolute left-3 top-3 text-[11px] text-slate-500 select-none">
              Letter 8.5in × 11in — margin 0.5in (placeholder)
            </div>
            <div className="h-full w-full flex items-center justify-center">
              <span className="text-slate-400">Canvas placeholder</span>
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
                  <button className="px-2 py-1 border rounded">Portrait</button>
                  <button className="px-2 py-1 border rounded">Landscape</button>
                </div>
                <label className="col-span-1">Margin</label>
                <div className="col-span-1 flex gap-1">
                  <button className="px-2 py-1 border rounded">0.5 in</button>
                  <button className="px-2 py-1 border rounded">1 in</button>
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
        <div className="flex items-center gap-4">
          <span>Zoom: 100%</span>
          <span>Standards: none</span>
        </div>
        <div className="text-muted-foreground">
          Images may be AI generated and include a SynthID watermark
        </div>
      </footer>
    </div>
  );
}

