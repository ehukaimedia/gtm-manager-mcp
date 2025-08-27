# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript MCP server (`index.ts`), utilities (`callbackServer.ts`, `cli.ts`). Compiles to `dist/`.
- `data/`: Runtime OAuth tokens at `data/gtm-token.json` (gitignored).
- `.env.example`: Copy to `.env` for local development.
- Callback endpoint is served inline at `/callback` by `src/callbackServer.ts` (no static assets).
- Tests live in `src/__tests__/` or `tests/` and use `*.test.ts` naming.

## Build, Test, and Development Commands
- `npm install`: Install dependencies (Node 18+).
- `npm run build`: Compile TypeScript to `dist/`.
- `npm run dev`: Run in watch/dev mode.
- `npm test`: Execute tests when present.
- `npm run serve:callback`: Start local OAuth callback at `http://localhost:3101/callback`.
- `npm run cli -- auth:url`: Print OAuth URL.
- `npm run auth:exchange -- <code>`: Exchange code and persist tokens.

## Coding Style & Naming Conventions
- Language: TypeScript; indentation: 2 spaces; quotes: single; end each statement with semicolons.
- Naming: `camelCase` variables/functions, `PascalCase` classes, `kebab-case` for new filenames.
- Prefer explicit types and narrow return values. Surface clear, actionable errors to MCP clients.
- If configured, use ESLint + Prettier; otherwise mirror the style in `src/index.ts`.

## Testing Guidelines
- Place tests in `src/__tests__/` or `tests/` with `*.test.ts` suffix.
- Aim to cover tool handlers (auth, tags, variables, triggers) and error paths.
- Use lightweight fixtures/mocks for Google APIs. Run with `npm test`.

## Commit & Pull Request Guidelines
- Commits: Conventional, imperative subjects (e.g., `feat: add variable update tool`, `fix: handle missing GTM_ID`).
- PRs: Include a summary, rationale, linked issues, and a test plan (commands and expected output). Note any env vars or scopes added; screenshots/logs for OAuth or MCP output are welcome.

## Security & Configuration Tips
- Never commit secrets. Use a local `.env` (copy from `.env.example`).
- Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; optional: `GTM_ID`.
- Tokens persist to `data/gtm-token.json` and are not committed.
