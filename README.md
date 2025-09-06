# Checkfu — personalized learning materials for kindergarteners

<p align="center">
  <img width="1237" height="900" alt="Screenshot 2025-09-06 at 4 16 33 PM" src="https://github.com/user-attachments/assets/b7f99bdb-1d04-41ff-b77c-ddf842f6fc53" />
</p>

Checkfu generates printable black-and-white Kindergarten worksheets and coloring pages. Each node is a single 8.5×11 page with one image; you can refine a page with a prompt to create a child variant. Pages can be exported to PDF to save and/or print.

## Quick Start

- Prereqs: Node 18+, npm
- Install: `npm install`
- Run: `npm run dev` and open `http://localhost:3000/editor`
- Set API key: open Settings (top right) and paste your Gemini key (`CHECKFU_GEMINI_API_KEY` stored in localStorage). Keys are client-side and for prototyping only.

## Use The Editor

- Create: Click `New` or drop/paste an image (file, URL, or clipboard) into the graph area to create a node.
- Refine/Branch: Click on a node to branch out using a specified prompt.
- Presets: Choose Worksheet or Coloring Book, then pick a preset. Kindergarten standards (K.*) can be selected to guide prompts.
- Standards → Prompt: Selecting standards appends a `<common-core>` XML block to the end of the prompt for clear separation from your text.
- Export: Use `Export Current`, `Export Selected`, or `Export All` to create a letter-size PDF. Print CSS supports direct browser printing.

## Additional Notes

- Will set up with Convex for database and Clerk for auth later. They have been disabled/commented out in the repo.
