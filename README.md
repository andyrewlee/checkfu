# Checkfu — Kindergarten Worksheet & Coloring Generator

<p align="center">
  <img width="1237" height="900" alt="Screenshot 2025-09-06 at 4 16 33 PM" src="https://github.com/user-attachments/assets/b7f99bdb-1d04-41ff-b77c-ddf842f6fc53" />
</p>

Checkfu generates printable black-and-white Kindergarten worksheets and coloring pages. Each node is a single 8.5×11 page with one image; you can refine a page with a prompt to create a child variant and export to PDF or print.

## Quick Start

- Prereqs: Node 18+, npm
- Install: `npm install`
- Run: `npm run dev` and open `http://localhost:3000/editor`
- Set API key: open Settings (top right) and paste your Gemini key (`CHECKFU_GEMINI_API_KEY` stored in localStorage). Keys are client-side and for prototyping only.

## Use The Editor

- Create: Click `New` or drop/paste an image (file, URL, or clipboard) into the graph area to create a node.
- Auto B/W: Uploads convert to high-contrast black/white automatically for clean prints.
- Refine/Branch: On a node, click `+` to enter a prompt and create a child variant. Cmd/Ctrl+Click the header for quick-generate using the last prompt.
- Presets: Choose Worksheet or Coloring Book, then pick a preset. Kindergarten standards (K.*) can be selected to guide prompts.
- Standards → Prompt: Selecting standards appends a `<common-core>` XML block to the end of the prompt for clear separation from your text.
- Export: Use `Export Current`, `Export Selected`, or `Export All` to create a letter-size PDF. Print CSS supports direct browser printing.

## Keyboard Shortcuts

- Quick Generate: Cmd/Ctrl+Enter (current node)
- Delete Node: Delete/Backspace (when not typing)
- Node Header Quick Generate: Cmd/Ctrl+Click header
- Inpainting (if enabled): `I` to toggle, `Esc` to exit, `[`/`]` to change brush size

## Notes & Limits

- Scope: Kindergarten only (K.CC, K.OA, K.MD). Quantities ≤ 10 for worksheets.
- Image Fetching: Some remote URLs block cross-origin fetch. If a dropped/pasted URL fails, download the image and upload the file.
- Resolution: Images are processed to ~150 DPI letter for speed. PDF export centers within margins without cropping.
- Safety: Designed for educational, black-ink line art. Do not upload identifiable photos of children.

## Where To Look

- Product spec: `prd.md` (simplified PageNode, flows, milestones)
- Page node: `components/nodes/PageNode.tsx`
- Page preview: `components/PagePreview.tsx`
- Editor route: `app/editor/page.tsx`
- Gemini helpers: `lib/nanoBanana.ts`

## License

For hackathon/demo use. See repository terms or add a license as needed.
Screenshot note: To render the image on GitHub, place your PNG at `public/readme-hero.png` (recommended size around 2474×1800).
