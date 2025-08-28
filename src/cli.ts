#!/usr/bin/env node
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.GTM_TOKEN_DIR || path.join(BASE_DIR, 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'gtm-token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  'https://www.googleapis.com/auth/tagmanager.publish',
];

function loadDotEnv() {
  const envPath = path.join(BASE_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(keys: string[]) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function ensureDirSecure(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeFileSecure(p: string, data: string) {
  try {
    fs.writeFileSync(p, data, { mode: 0o600 });
  } catch {
    fs.writeFileSync(p, data);
  }
}

async function cmdAuthUrl() {
  requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  console.log(url);
}

async function cmdAuthExchange(code?: string) {
  if (!code) {
    console.error('Usage: npm run cli -- auth:exchange <authorization_code>');
    process.exit(1);
  }
  requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const authCode = code as string;
  const { tokens } = await oauth2.getToken(authCode);
  ensureDirSecure(DATA_DIR);
  writeFileSecure(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Saved tokens to ${TOKEN_PATH}`);
}

async function withAuth() {
  requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const tokenPath = TOKEN_PATH;
  if (!fs.existsSync(tokenPath)) {
    console.error(`Token not found at ${tokenPath}. Run auth:url then auth:exchange.`);
    process.exit(1);
  }
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  oauth2.setCredentials(tokens);
  const tagmanager = google.tagmanager({ version: 'v2', auth: oauth2 });
  return tagmanager;
}

async function findContainer(tagmanager: any, gtmId: string) {
  const accounts = await tagmanager.accounts.list();
  for (const account of accounts.data.account || []) {
    const containers = await tagmanager.accounts.containers.list({ parent: `accounts/${account.accountId}` });
    const container = containers.data.container?.find((c: any) => c.publicId === gtmId);
    if (container) return { accountId: account.accountId as string, containerId: container.containerId as string };
  }
  console.error(`Container ${gtmId} not found`);
  process.exit(1);
}

async function cmdCreateVersion(name?: string, notes?: string) {
  if (!process.env.GTM_ID) {
    console.error('GTM_ID is required in environment');
    process.exit(1);
  }
  const tagmanager = await withAuth();
  const { accountId, containerId } = await findContainer(tagmanager, process.env.GTM_ID as string);
  const workspaces = await tagmanager.accounts.containers.workspaces.list({ parent: `accounts/${accountId}/containers/${containerId}` });
  const workspace = workspaces.data.workspace?.[0];
  if (!workspace) {
    console.error('No workspace found');
    process.exit(1);
  }
  const resp = await tagmanager.accounts.containers.workspaces.create_version({
    path: `accounts/${accountId}/containers/${containerId}/workspaces/${workspace.workspaceId}`,
    requestBody: { name, notes },
  });
  const versionId = (resp as any).data?.containerVersion?.containerVersionId || (resp as any).data?.containerVersionId;
  console.log(`Created version: ${versionId || 'unknown'}`);
}

async function cmdPublishVersion(versionId?: string) {
  if (!versionId) {
    console.error('Usage: npm run version:publish -- <versionId>');
    process.exit(1);
  }
  if (!process.env.GTM_ID) {
    console.error('GTM_ID is required in environment');
    process.exit(1);
  }
  const tagmanager = await withAuth();
  const { accountId, containerId } = await findContainer(tagmanager, process.env.GTM_ID as string);
  await tagmanager.accounts.containers.versions.publish({
    path: `accounts/${accountId}/containers/${containerId}/versions/${versionId}`,
  });
  console.log(`Published version: ${versionId}`);
}

async function cmdSubmit(name?: string, notes?: string) {
  if (!process.env.GTM_ID) {
    console.error('GTM_ID is required in environment');
    process.exit(1);
  }
  const tagmanager = await withAuth();
  const { accountId, containerId } = await findContainer(tagmanager, process.env.GTM_ID as string);
  const workspaces = await tagmanager.accounts.containers.workspaces.list({ parent: `accounts/${accountId}/containers/${containerId}` });
  const workspace = workspaces.data.workspace?.[0];
  if (!workspace) {
    console.error('No workspace found');
    process.exit(1);
  }
  const created = await tagmanager.accounts.containers.workspaces.create_version({
    path: `accounts/${accountId}/containers/${containerId}/workspaces/${workspace.workspaceId}`,
    requestBody: { name, notes },
  });
  const versionId = (created as any).data?.containerVersion?.containerVersionId || (created as any).data?.containerVersionId;
  if (!versionId) {
    console.error('Failed to create version');
    process.exit(1);
  }
  await tagmanager.accounts.containers.versions.publish({
    path: `accounts/${accountId}/containers/${containerId}/versions/${versionId}`,
  });
  console.log(`Submit done. Published version: ${versionId}`);
}

async function main() {
  loadDotEnv();
  const [, , cmd, arg1] = process.argv;
  switch (cmd) {
    case 'auth:url':
      await cmdAuthUrl();
      break;
    case 'auth:exchange':
      await cmdAuthExchange(arg1);
      break;
    case 'version:create':
      await cmdCreateVersion(arg1, process.argv[4]);
      break;
    case 'version:publish':
      await cmdPublishVersion(arg1);
      break;
    case 'submit':
      await cmdSubmit(arg1, process.argv[4]);
      break;
    default:
      console.log('Usage:');
      console.log('  npm run cli -- auth:url              # Print Google OAuth URL');
      console.log('  npm run cli -- auth:exchange <code>  # Exchange code for tokens');
      console.log('  npm run cli -- version:create [name] [notes]  # Create container version');
      console.log('  npm run cli -- version:publish <versionId>    # Publish container version');
      console.log('  npm run cli -- submit [name] [notes]          # Create version and publish');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
