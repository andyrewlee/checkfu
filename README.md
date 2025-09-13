# Checkfu — personalized learning materials for kindergarteners

<p align="center">
  <img width="1200" height="631" alt="Screenshot 2025-09-08 at 2 38 46 AM" src="https://github.com/user-attachments/assets/b239f398-5809-4741-b589-ce1db764fe5e" />
</p>

Checkfu generates printable black-and-white Kindergarten worksheets and coloring pages. Each node is a single 8.5×11 page with one image; you can refine a page with a prompt to create a child variant. Pages can be exported to PDF to save and/or print.

## Quick Start

- Prereqs: Node 18+, npm
- Install: `npm install`
- Run: `npm run dev` and open `http://localhost:3000/editor`
- Configure AI (server-only): set your Gemini API key in Convex env vars so actions can call `@google/genai`.
  - Local/dev: `npx convex env set GOOGLE_GENERATIVE_AI_API_KEY <your-key>`
  - Prod: Convex Dashboard → Settings → Environment Variables → add `GOOGLE_GENERATIVE_AI_API_KEY`
  - Never paste keys into the client; all generation runs on the server in Convex actions.

## Use The Editor

- Create: Click `New` or drop/paste an image (file, URL, or clipboard) into the graph area to create a node.
- Refine/Branch: Click on a node to branch out using a specified prompt.
- Presets: Choose Worksheet or Coloring Book, then pick a preset. Kindergarten standards (K.\*) can be selected to guide prompts.
- Standards → Prompt: Selecting standards appends a `<common-core>` XML block to the end of the prompt for clear separation from your text.
- Export: Use `Export Current`, `Export Selected`, or `Export All` to create a letter-size PDF. Print CSS supports direct browser printing.
