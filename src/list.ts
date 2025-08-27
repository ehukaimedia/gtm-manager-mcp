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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadDotEnv();
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const tokenPath = process.env.GTM_TOKEN_DIR
    ? path.join(BASE_DIR, process.env.GTM_TOKEN_DIR, 'gtm-token.json')
    : path.join(BASE_DIR, 'data', 'gtm-token.json');
  if (!fs.existsSync(tokenPath)) throw new Error(`Token not found at ${tokenPath}`);
  oauth2.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')));

  const gtmId = process.env.GTM_ID as string;
  if (!gtmId) throw new Error('GTM_ID is required');

  const tagmanager = google.tagmanager({ version: 'v2', auth: oauth2 });
  const accounts = await tagmanager.accounts.list();
  let accountId: string | undefined;
  let containerId: string | undefined;
  for (const account of accounts.data.account || []) {
    const containers = await tagmanager.accounts.containers.list({ parent: `accounts/${account.accountId}` });
    const found = containers.data.container?.find((c: any) => c.publicId === gtmId);
    if (found) { accountId = account.accountId as string; containerId = found.containerId as string; break; }
  }
  if (!accountId || !containerId) throw new Error(`Container ${gtmId} not found`);

  const workspaces = await tagmanager.accounts.containers.workspaces.list({ parent: `accounts/${accountId}/containers/${containerId}` });
  const ws = workspaces.data.workspace?.[0]?.workspaceId as string;
  if (!ws) throw new Error('No workspace found');

  const tags = await tagmanager.accounts.containers.workspaces.tags.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  const variables = await tagmanager.accounts.containers.workspaces.variables.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });

  console.log(`Tags (${tags.data.tag?.length || 0}):`);
  for (const t of tags.data.tag || []) console.log(`- ${t.name} (${t.type}) ID=${t.tagId}`);
  console.log(`Variables (${variables.data.variable?.length || 0}):`);
  for (const v of variables.data.variable || []) console.log(`- ${v.name} (${v.type}) ID=${v.variableId}`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });

