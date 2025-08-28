# GTM Manager MCP — Global Project Guide

Use the GTM Manager MCP tool globally across projects to authenticate with Google Tag Manager, manage tags/variables/triggers, and submit/publish container versions.

## Prerequisites
- Node.js 18+ and npm.
- Google Cloud: Tag Manager API enabled, OAuth Client (Web) with redirect `http://localhost:3101/callback`.
- Container permissions for your Google account: Edit, Approve, Publish.
- Required OAuth scopes (must all be granted):
  - https://www.googleapis.com/auth/tagmanager.readonly
  - https://www.googleapis.com/auth/tagmanager.edit.containers
  - https://www.googleapis.com/auth/tagmanager.edit.containerversions
  - https://www.googleapis.com/auth/tagmanager.publish

## Install Globally (Local, Not Published)
- From the GTM Manager MCP repo on your machine:
  - `npm run build`
  - `npm i -g .`  (installs the binaries globally from your local checkout)
- For live development: `npm link` (re-run `npm run build` to refresh `dist/`).
- To update your global install later, repeat: `npm run build && npm i -g .`
- To uninstall (if linked or installed): `npm unlink -g gtm-mcp gtm-mcp-callback gtm-mcp-auth`.

Global binaries installed:
- `gtm-mcp`: MCP server (stdio)
- `gtm-mcp-callback`: Local OAuth callback at `http://127.0.0.1:3101/callback`
- `gtm-mcp-auth`: Auth + version helpers (auth:url, auth:exchange, version:create, version:publish, submit)

## Per‑Project Setup
Create `.env` in your project (tokens stay local via `GTM_TOKEN_DIR`):

```
# /Users/ehukaimedia/Desktop/Local-Sites/ehukai-media/.env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3101/callback
GTM_ID=GTM-XXXXXXX
GTM_TOKEN_DIR=.gtm
```

Add `.gtm/` to your VCS ignore.

Quick start checklist per project:
1) Create `.env` with creds, `GTM_ID`, and `GTM_TOKEN_DIR=.gtm`
2) Run `gtm-mcp-callback`
3) Run `gtm-mcp-auth auth:url` → approve → `gtm-mcp-auth auth:exchange "<code>"`
4) Use your MCP client with `gtm-mcp` (loads the project’s `.env`)

## Authenticate (One‑Time per Project)
From the project folder:

- Start callback (keep running): `gtm-mcp-callback`
- Get URL: `gtm-mcp-auth auth:url` → open and approve
- Exchange code: `gtm-mcp-auth auth:exchange "<code>"`

Tokens are saved to `<project>/.gtm/gtm-token.json` with secure permissions.

## Use with an MCP Client
Configure your client to launch the server with project env:

```
command: bash
args: ["-lc", "set -a; source /Users/ehukaimedia/Desktop/Local-Sites/ehukai-media/.env; exec gtm-mcp"]
```

Common tools (from your MCP client): `gtm_auth`, `gtm_authenticate`, `gtm_list_tags`, `gtm_list_variables`, `gtm_create_tag`, `gtm_create_variable`, `gtm_create_trigger`, `gtm_create_version`, `gtm_publish_version`, `gtm_submit`.

## CLI Shortcuts
- Submit (create + publish): `gtm-mcp-auth submit "Name" "Notes"`
- Create version: `gtm-mcp-auth version:create "Name" "Notes"`
- Publish: `gtm-mcp-auth version:publish <versionId>`

## Troubleshooting
- Insufficient authentication scopes: Re‑consent with `gtm-mcp-auth auth:url` and ensure all scopes above are listed before exchanging.
- Insufficient permissions: In GTM Admin → Container → User Management, grant your Google account Edit, Approve, Publish.
- Token not found: Ensure `GTM_TOKEN_DIR` is set in `.env` and you ran `auth:exchange` from the project.
- Callback port busy: The callback listens on 127.0.0.1:3101. If you change the port, update `GOOGLE_REDIRECT_URI` in `.env` and in Google Cloud OAuth settings.

## Security Notes
- Tokens are stored per project under `GTM_TOKEN_DIR` with restrictive permissions.
- Never commit tokens or secrets. Keep `.gtm/` ignored.
- Limit scopes and GTM permissions to least privilege necessary.
