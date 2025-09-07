# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript MCP server. Entry `index.ts`; OAuth callback server at `/callback` in `callbackServer.ts`; CLI utilities in `cli.ts`. Binaries compile into `dist/` (`bin.js`, `callbackBin.js`, `cli.js`).
- `data/`: Runtime OAuth tokens (e.g., `data/gtm-token.json`). Gitignored.
- `tests/`: Integration tests as ESM files `*.test.mjs`, executed by `tests/run-tests.mjs`.
- `src/__tests__/`: TypeScript tests/mocks used during development.
- `.env.example`: Copy to `.env` for local development.

## Build, Test, and Development Commands
- `npm install`: Install dependencies (Node 18+).
- `npm run build`: Compile TypeScript to `dist/`.
- `npm run dev`: Start MCP server from sources (ts-node).
- `npm start`: Run the built server (`dist/index.js`).
- `npm test`: Build then execute `tests/run-tests.mjs` (discovers `tests/**/*.test.mjs`).
- `npm run serve:callback`: Serve OAuth callback at `http://localhost:3101/callback`.
- `gtm-mcp-auth auth:url` or `npm run auth:url`: Print OAuth URL to initiate auth.
- `gtm-mcp-auth auth:exchange <code>` or `npm run auth:exchange -- <code>`: Exchange code and persist tokens.

## Coding Style & Naming Conventions
- TypeScript; 2-space indent; single quotes; semicolons.
- Naming: camelCase (variables/functions), PascalCase (classes), kebab-case (filenames).
- Prefer explicit types and narrow return values; surface actionable errors to MCP clients.
- If ESLint/Prettier is configured, run them; otherwise mirror `src/index.ts` style.

## Testing Guidelines
- Primary tests live in `tests/` as `*.test.mjs` (ESM). Each test exports `default`, `run`, or `test`.
- Dev-only TS tests/mocks in `src/__tests__/`.
- Run with `npm test`; mock Google APIs to avoid real network calls.

## Commit & Pull Request Guidelines
- Commits: conventional, imperative (e.g., `feat: add variable update tool`, `fix: handle missing GTM_ID`).
- PRs: include summary, rationale, linked issues, and a test plan (commands + expected output). Note any env vars/scopes added and attach relevant logs/screenshots.

## Security & Configuration Tips
- Never commit secrets. Use a local `.env` (copy from `.env.example`).
- Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; optional: `GTM_ID`.
- Tokens persist to `data/gtm-token.json` and are not committed.
- Limit OAuth scopes to what is needed.
