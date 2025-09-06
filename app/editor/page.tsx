"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, applyNodeChanges } from "reactflow";
import type { Edge, Node, NodeChange } from "reactflow";
import PageNode, { type PageNodeData } from "@/components/nodes/PageNode";

type LeftTab = "templates" | "pages";
type Orientation = "portrait" | "landscape";
type Page = {
  id: string;
  title: string;
  orientation: Orientation;
  marginInches: number;
};

export default function EditorPage() {
  const [leftTab, setLeftTab] = useState<LeftTab>("templates");
  const [pages, setPages] = useState<Page[]>(() => [{
    id: "root",
    title: "Base",
    orientation: "portrait",
    marginInches: 0.5,
  }]);
  const [currentPageId, setCurrentPageId] = useState<string>("root");
  const currentPage = pages.find(p => p.id === currentPageId) ?? pages[0];
  const orientation = currentPage?.orientation ?? "portrait";
  const marginInches = currentPage?.marginInches ?? 0.5;

  // React Flow nodes/edges state
  const [nodes, setNodes] = useState<Node<PageNodeData>[]>([
    {
      id: "root",
      type: "page",
      position: { x: 0, y: 0 },
      data: {
        id: "root",
        title: "Base",
        orientation: "portrait",
        marginInches: 0.5,
        onBranch: (id) => branchFrom(id),
      },
      selected: true,
    },
  ]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const branchFrom = (parentId: string) => {
    const parent = pages.find(p => p.id === parentId);
    if (!parent) return;
    const id = crypto.randomUUID();
    const newPage: Page = {
      ...parent,
      id,
      title: `${parent.title} variant`,
    };
    setPages(ps => ps.concat(newPage));
    const parentNode = nodes.find(n => n.id === parentId);
    const newPos = parentNode ? { x: parentNode.position.x + 300, y: parentNode.position.y + 40 } : { x: 0, y: 0 };
    setNodes(ns => ns.concat({
      id,
      type: "page",
      position: newPos,
      data: {
        id,
        title: newPage.title,
        orientation: newPage.orientation,
        marginInches: newPage.marginInches,
        onBranch: (pid) => branchFrom(pid),
      },
      selected: false,
    }));
    setEdges(es => es.concat({ id: crypto.randomUUID(), source: parentId, target: id }));
    setCurrentPageId(id);
  };

  // Keep node data in sync with page changes
  useEffect(() => {
    setNodes((ns) =>
      pages.map((p) => {
        const existing = ns.find((n) => n.id === p.id);
        return {
          id: p.id,
          type: "page" as const,
          position: existing?.position ?? { x: 0, y: 0 },
          selected: existing?.selected ?? p.id === currentPageId,
          data: {
            id: p.id,
            title: p.title,
            orientation: p.orientation,
            marginInches: p.marginInches,
            onBranch: (pid: string) => branchFrom(pid),
          },
        } satisfies Node<PageNodeData>;
      })
    );
  }, [pages, currentPageId]);

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
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
      <div className="h-[calc(100vh-56px)] grid" style={{ gridTemplateColumns: "260px 1fr 320px" }}>
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
                <p className="text-muted-foreground">Pages</p>
                <ul className="space-y-1">
                  {pages.map((p) => (
                    <li key={p.id}>
                      <button
                        className={`w-full text-left px-2 py-1 rounded hover:bg-accent ${currentPageId === p.id ? 'bg-accent' : ''}`}
                        onClick={() => setCurrentPageId(p.id)}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>

        {/* Graph is the editor */}
        <main className="bg-muted/20 overflow-hidden" aria-label="Graph editor">
          <div className="w-full h-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              nodeTypes={{ page: PageNode }}
              onNodesChange={onNodesChange}
              onSelectionChange={({ nodes }) => {
                if (nodes && nodes[0]) setCurrentPageId(nodes[0].id);
              }}
            >
              <Background />
              <Controls />
            </ReactFlow>
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
                    onClick={() => updateCurrent(pages, setPages, currentPageId, { orientation: "portrait" })}
                  >
                    Portrait
                  </button>
                  <button
                    className={`px-2 py-1 border rounded ${orientation === "landscape" ? "bg-accent" : ""}`}
                    aria-pressed={orientation === "landscape"}
                    onClick={() => updateCurrent(pages, setPages, currentPageId, { orientation: "landscape" })}
                  >
                    Landscape
                  </button>
                </div>
                <label className="col-span-1">Margin</label>
                <div className="col-span-1 flex gap-1">
                  <button
                    className={`px-2 py-1 border rounded ${marginInches === 0.5 ? "bg-accent" : ""}`}
                    aria-pressed={marginInches === 0.5}
                    onClick={() => updateCurrent(pages, setPages, currentPageId, { marginInches: 0.5 })}
                  >
                    0.5 in
                  </button>
                  <button
                    className={`px-2 py-1 border rounded ${marginInches === 1 ? "bg-accent" : ""}`}
                    aria-pressed={marginInches === 1}
                    onClick={() => updateCurrent(pages, setPages, currentPageId, { marginInches: 1 })}
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

      {/* Footer removed intentionally */}
    </div>
  );
}

function updateCurrent(
  pages: Page[],
  setPages: React.Dispatch<React.SetStateAction<Page[]>>,
  currentId: string,
  patch: Partial<Page>
) {
  if (!pages.find((p) => p.id === currentId)) return;
  setPages((ps) => ps.map((p) => (p.id === currentId ? { ...p, ...patch } : p)));
}
