# Changelog

All notable changes to this project will be documented in this file.

## 0.1.3 - 2025-08-27

- feat: add global auth binary `gtm-mcp-auth` (auth:url, auth:exchange)
- docs: replace references to gtm-manager-auth with gtm-mcp-auth in README/callback page

## 0.1.2 - 2025-08-27

- feat: add `tagmanager.edit.containerversions` OAuth scope to enable version create/publish
- docs: update README with required scopes and re-consent steps
- test: add unit tests for tags, triggers, variables, submit, and publish (mocked Google APIs)
- chore: add simple test runner and helper mocks

## 0.1.1 - 2025-08-27

- initial MCP server functionality and CLI utilities
- scripts: submit, create version, publish version
