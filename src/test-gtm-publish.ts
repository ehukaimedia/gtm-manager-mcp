import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.join(__dirname, '..');

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
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

function resolveTokenPath(): string {
  const candidates: string[] = [];
  const tokenDir = process.env.GTM_TOKEN_DIR || '';
  if (tokenDir) {
    const abs = path.isAbsolute(tokenDir) ? tokenDir : path.join(BASE_DIR, tokenDir);
    candidates.push(path.join(abs, 'gtm-token.json'));
  }
  candidates.push(path.join(BASE_DIR, 'data', 'gtm-token.json'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  if (tokenDir) return path.join(path.isAbsolute(tokenDir) ? tokenDir : path.join(BASE_DIR, tokenDir), 'gtm-token.json');
  return path.join(BASE_DIR, 'data', 'gtm-token.json');
}

async function findContainer(tagmanager: any, gtmId: string) {
  const accounts = await tagmanager.accounts.list();
  for (const account of accounts.data.account || []) {
    const containers = await tagmanager.accounts.containers.list({ parent: `accounts/${account.accountId}` });
    const container = containers.data.container?.find((c: any) => c.publicId === gtmId);
    if (container) return { accountId: account.accountId as string, containerId: container.containerId as string };
  }
  throw new Error(`Container ${gtmId} not found`);
}

async function main() {
  loadDotEnv();
  requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GTM_ID']);

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const tokenPath = resolveTokenPath();
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Token not found at ${tokenPath}. Run: npm run cli -- auth:url && npm run auth:exchange -- <code>`);
  }
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  oauth2.setCredentials(tokens);
  const tagmanager = google.tagmanager({ version: 'v2', auth: oauth2 });

  const { accountId, containerId } = await findContainer(tagmanager, process.env.GTM_ID as string);
  const workspaces = await tagmanager.accounts.containers.workspaces.list({ parent: `accounts/${accountId}/containers/${containerId}` });
  const workspace = workspaces.data.workspace?.[0];
  if (!workspace) throw new Error('No workspace found');
  const ws = workspace.workspaceId as string;

  // Optional: accept version id from args; if missing, create one
  const maybeVersionId = process.argv[2];
  let versionId = maybeVersionId;
  if (!versionId) {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
    const name = `Publish Test ${stamp}`;
    const notes = 'Automated publish test';
    console.log('No versionId provided. Creating a version to publish...');
    const created = await tagmanager.accounts.containers.workspaces.create_version({
      path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}`,
      requestBody: { name, notes },
    } as any);
    versionId = (created as any).data?.containerVersion?.containerVersionId || (created as any).data?.containerVersionId;
    if (!versionId) throw new Error('Failed to create version');
    console.log(`Created version: ${versionId}`);
  }

  console.log(`Publishing version: ${versionId} ...`);
  await tagmanager.accounts.containers.versions.publish({
    path: `accounts/${accountId}/containers/${containerId}/versions/${versionId}`,
  });
  console.log(`Published version: ${versionId}`);
  console.log('Publish test completed successfully.');
}

main().catch((err) => {
  console.error('GTM Publish test failed:', err.message || err);
  process.exit(1);
});

