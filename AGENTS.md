# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript MCP server. Core entry `index.ts`; OAuth callback served inline via `callbackServer.ts` at `/callback`; CLI utilities in `cli.ts`. Compiles to `dist/`.
- `data/`: Runtime OAuth tokens `data/gtm-token.json` (gitignored).
- `tests/` or `src/__tests__/`: Unit/integration tests named `*.test.ts`.
- `.env.example`: Copy to `.env` for local development.

## Build, Test, and Development Commands
- `npm install`: Install dependencies (Node 18+).
- `npm run build`: Compile TypeScript to `dist/`.
- `npm run dev`: Run server in watch/dev mode.
- `npm test`: Execute test suite.
- `npm run serve:callback`: Start local OAuth callback at `http://localhost:3101/callback`.
- `gtm-mcp-auth auth:url` or `npm run cli -- auth:url`: Print OAuth URL.
- `gtm-mcp-auth auth:exchange <code>` or `npm run auth:exchange -- <code>`: Exchange code and persist tokens.

## Coding Style & Naming Conventions
- TypeScript; 2-space indentation; single quotes; end with semicolons.
- Naming: camelCase variables/functions, PascalCase classes, kebab-case filenames.
- Prefer explicit types and narrow return values; surface clear, actionable errors to MCP clients.
- If configured, use ESLint + Prettier; otherwise mirror `src/index.ts` style.

## Testing Guidelines
- Place tests in `src/__tests__/` or `tests/` with `*.test.ts` suffix.
- Cover tool handlers (auth, tags, variables, triggers) and error paths.
- Use lightweight fixtures/mocks for Google APIs.
- Run with `npm test`.

## Commit & Pull Request Guidelines
- Commits: Conventional and imperative (e.g., `feat: add variable update tool`, `fix: handle missing GTM_ID`).
- PRs: Include summary, rationale, linked issues, and a test plan (commands + expected output). Note any env vars/scopes added; attach relevant OAuth or MCP logs/screenshots.

## Security & Configuration Tips
- Never commit secrets. Use a local `.env` (copy from `.env.example`).
- Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; optional: `GTM_ID`.
- Tokens persist to `data/gtm-token.json` and are not committed.
