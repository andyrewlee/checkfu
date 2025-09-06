"use client";

import { useCallback, useEffect, useState } from "react";
import ReactFlow, { Background, Controls, addEdge, applyNodeChanges } from "reactflow";
import { jsPDF } from "jspdf";
import type { Edge, Node, NodeChange, Connection } from "reactflow";
import PageNode, { type PageNodeData } from "@/components/nodes/PageNode";

type LeftTab = "templates" | "pages";
type Orientation = "portrait" | "landscape";
type Page = {
  id: string;
  title: string;
  orientation: Orientation;
  marginInches: number;
};
type TextElement = {
  id: string;
  x: number; // px in page space (96 DPI)
  y: number; // px in page space (96 DPI)
  content: string;
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
  const [elementsByPage, setElementsByPage] = useState<Record<string, TextElement[]>>({ root: [] });

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
        onDropText: (id, x, y) => addTextToPage(id, x, y),
        texts: [],
        onTextsChange: (pid, next) => setElementsByPage((m) => ({ ...m, [pid]: next })),
      },
      selected: true,
    },
  ]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const handleTextsChange = useCallback(
    (pid: string, next: TextElement[]) =>
      setElementsByPage((m) => ({ ...m, [pid]: next })),
    []
  );
  const addTextToPage = useCallback((pageId: string, x: number, y: number) => {
    const id = crypto.randomUUID();
    const el: TextElement = { id, x, y, content: "Text" };
    setElementsByPage((m) => ({ ...m, [pageId]: (m[pageId] ?? []).concat(el) }));
  }, []);

  const createPageNode = useCallback(
    (p: Page, position: { x: number; y: number }): Node<PageNodeData> => ({
      id: p.id,
      type: "page",
      position,
      dragHandle: ".rf-node-drag",
      data: {
        id: p.id,
        title: p.title,
        orientation: p.orientation,
        marginInches: p.marginInches,
        onBranch: (pid) => branchFrom(pid),
        onDropText: (pid, x, y) => addTextToPage(pid, x, y),
        texts: elementsByPage[p.id] ?? [],
        onTextsChange: (pid, next) => handleTextsChange(pid, next),
      },
    }),
    [addTextToPage, elementsByPage, handleTextsChange]
  );

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
    const verticalGap = 340; // px between parent and child
    const newPos = parentNode
      ? { x: parentNode.position.x, y: parentNode.position.y + verticalGap }
      : { x: 0, y: verticalGap };
    setNodes((ns) => ns.concat(createPageNode(newPage, newPos)));
    setEdges(es => es.concat({ id: crypto.randomUUID(), source: parentId, target: id }));
    setCurrentPageId(id);
  };

  // Keep node data in sync with page changes
  useEffect(() => {
    setNodes((ns) =>
      pages.map((p) => {
        const existing = ns.find((n) => n.id === p.id);
        const base = createPageNode(p, existing?.position ?? { x: 0, y: 0 });
        return { ...base, selected: existing?.selected ?? p.id === currentPageId };
      })
    );
  }, [pages, currentPageId, createPageNode]);

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  };

  function renderPageToCanvas(page: Page, texts: TextElement[]) {
    const DPI = 96;
    const wIn = page.orientation === "portrait" ? 8.5 : 11;
    const hIn = page.orientation === "portrait" ? 11 : 8.5;
    const w = Math.round(wIn * DPI);
    const h = Math.round(hIn * DPI);
    const canvas = document.createElement("canvas");
    const dpr = 2; // crisper output in PDF
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    // dashed safe margin
    const m = Math.round(page.marginInches * DPI);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(m + 1, m + 1, Math.max(0, w - 2 * m - 2), Math.max(0, h - 2 * m - 2));
    // texts
    ctx.setLineDash([]);
    ctx.fillStyle = "#000";
    ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    texts.forEach((t) => {
      ctx.fillText(t.content, t.x, t.y);
    });
    return canvas;
  }

  function exportCurrentPageToPdf(page: Page, texts: TextElement[]) {
    const canvas = renderPageToCanvas(page, texts);
    const pdf = new jsPDF({
      orientation: page.orientation === "portrait" ? "portrait" : "landscape",
      unit: "in",
      format: "letter",
    });
    const dataUrl = canvas.toDataURL("image/png");
    const pageW = 8.5;
    const pageH = 11;
    const imgW = canvas.width / (2 * 96); // since dpr=2
    const imgH = canvas.height / (2 * 96);
    const scale = Math.min(pageW / imgW, pageH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    pdf.addImage(dataUrl, "PNG", x, y, w, h);
    pdf.save("checkfu.pdf");
  }

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
            onClick={() => exportCurrentPageToPdf(currentPage, elementsByPage[currentPageId] ?? [])}
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
              <div className="text-sm space-y-3">
                <p className="text-muted-foreground">Drag items into a Page node</p>
                <div className="flex gap-2">
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/checkfu", "text");
                      e.dataTransfer.setData("text/plain", "text");
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="px-2 py-1 border rounded"
                    title="Drag onto a Page"
                  >
                    Text
                  </button>
                </div>
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
              onConnect={(connection: Connection) => setEdges((es) => addEdge(connection, es))}
              onConnectStart={(_, params) => setConnectFrom(params?.nodeId ?? null)}
              onConnectEnd={(e) => {
                const target = e.target as HTMLElement | null;
                const isPane = target?.classList.contains("react-flow__pane");
                if (isPane && connectFrom) {
                  const parentNode = nodes.find((n) => n.id === connectFrom);
                  const parent = pages.find((p) => p.id === connectFrom);
                  if (!parent || !parentNode) return;
                  const id = crypto.randomUUID();
                  const newPage: Page = { ...parent, id, title: `${parent.title} variant` };
                  const verticalGap = 340;
                  const pos = { x: parentNode.position.x, y: parentNode.position.y + verticalGap };
                  setPages((ps) => ps.concat(newPage));
                  setNodes((ns) => ns.concat(createPageNode(newPage, pos)));
                  setEdges((es) => es.concat({ id: crypto.randomUUID(), source: connectFrom, target: id }));
                  setCurrentPageId(id);
                }
                setConnectFrom(null);
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
