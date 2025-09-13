# Repository Guidelines

## Project Structure & Module Organization

- `app/` – Next.js App Router (`page.tsx`, `layout.tsx`, print CSS in `globals.css`). Protected server pages live under `app/server` (see `middleware.ts`).
- `components/` – React UI (PascalCase `.tsx`).
- `store/` – Zustand state (`useEditorStore.ts`).
- `lib/` – Utilities (image helpers, Fabric, ids, pdf). Client Gemini helpers were removed; all AI runs server‑side via Convex actions.
- `convex/` – Convex backend (`schema.ts`, `auth.config.ts`, generated types in `_generated/` – do not edit).
- `public/` – Static assets (favicons, `ccss_kindergarten_math_standards.json`).
- `types/` – Type shims.
- Root config: `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `.prettierrc`.

## Build, Test, and Development Commands

- `npm install` – Install dependencies.
- `npm run dev` – Start Next.js and Convex in parallel.
- `npm run dev:frontend` / `npm run dev:backend` – Run each side alone.
- `npm run build` – Production build (Next.js). Required by pre‑push hook.
- `npm start` – Serve the production build.
- `npm run lint` – ESLint (Next + TS rules).
- `npm run typecheck` – Strict TypeScript check.
- Optional: `npm run predev` – Start Convex until ready, open dashboard.

## Coding Style & Naming Conventions

- TypeScript strict mode; prefer explicit types at module boundaries.
- Formatting via Prettier (auto-run on staged files). Use 2‑space indentation.
- ESLint extends `next/core-web-vitals` and `next/typescript`.
- React components: PascalCase files in `components/`; hooks start with `use*`.
- Imports: use `@/*` path alias (see `tsconfig.json`).
- Styling: Tailwind v4 via PostCSS; global tokens in `app/globals.css`.

## Testing Guidelines

- No test runner is configured yet. Rely on `lint` + `typecheck`.
- If adding tests, place `*.test.ts(x)` next to source and prefer Vitest or Jest with React Testing Library. Add `npm test` in `package.json` accordingly.

## Commit & Pull Request Guidelines

- Commits: short, imperative summaries (e.g., "Add undo and redo (#12)").
- Pre-commit runs Prettier, lint, and typecheck; fix before committing.
- Pre-push runs `npm run build`; ensure it passes locally.
- PRs: include purpose, linked issues, screenshots for UI, and clear reproduction steps. Keep changes scoped and incremental.

## Security & Configuration Tips

- Do not commit API keys. Configure the Gemini API key server-side only as a Convex environment variable `GOOGLE_GENERATIVE_AI_API_KEY`. Never store keys in the client or `localStorage`.
- Clerk: set `CLERK_JWT_ISSUER_DOMAIN` if enabling Convex auth (see `convex/auth.config.ts`).
- Avoid editing `convex/_generated/*` files.

## Convex Development

- Before editing `convex/*.ts` (schema, queries, mutations, actions), follow the guidelines in `.cursor/rules/convex_rules.mdc`.
- Use the new Convex function syntax with explicit `args` and `returns` validators, and prefer index-backed reads via `withIndex`.
