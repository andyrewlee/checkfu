# TODO — Integrate Fabric page canvas per checkfu-page-fabric-PR.md

- [x] Install dependency: `fabric@^6` (added to package.json; run `npm i` locally)
- [x] Add `components/PageCanvasFabric.tsx` (interactive Fabric canvas)
- [x] Add `components/LayersPanel.tsx` (layers list with z-order, lock, hide, delete)
- [x] Update `components/Editor.tsx` types: export `TextChild`/`ImageChild`; extend `Page` with `children` and `selectedChildId`
- [x] Update `components/Editor.tsx` node wiring: pass `children`, selection handlers; set `dragHandle: ".dragHandlePage"`
- [x] Update `components/Editor.tsx` UI: add Palette (drag Text; hint for image drop)
- [x] Update `components/Editor.tsx` new-page and import flows to initialize `children` and `selectedChildId`
- [x] Update export: add `flattenPageToPng` and use Fabric PNG when children exist
- [x] Update branching: prefer flattened page image as transform base
- [x] Add Layers panel + selected item properties in Inspector (toggle visibility/lock, move, delete; basic position/size fields)
- [x] Replace static preview with Fabric in `components/nodes/PageNode.tsx`; add header drag handle class
- [x] Sanity pass: adjust imports to `@/components/Editor` for types (typecheck pending local install)
