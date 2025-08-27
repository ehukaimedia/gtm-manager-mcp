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
  // Default to first candidate if directory exists, else data/
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

  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  const varName = `mcp_test_var_${stamp}`;
  const trigName = `mcp_test_trigger_${stamp}`;
  const tagName = `mcp_test_tag_${stamp}`;

  console.log('Creating variable...');
  const newVar = await tagmanager.accounts.containers.workspaces.variables.create({
    parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}`,
    requestBody: {
      name: varName,
      type: 'jsm',
      parameter: [{ type: 'template', key: 'javascript', value: 'function() { return "hello_world"; }' }],
    },
  });
  const variableId = newVar.data.variableId as string;
  console.log(`Variable created: ${varName} (ID: ${variableId})`);

  console.log('Creating trigger...');
  const newTrig = await tagmanager.accounts.containers.workspaces.triggers.create({
    parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}`,
    requestBody: { name: trigName, type: 'pageview' },
  });
  const triggerId = newTrig.data.triggerId as string;
  console.log(`Trigger created: ${trigName} (ID: ${triggerId})`);

  console.log('Creating tag...');
  const newTag = await tagmanager.accounts.containers.workspaces.tags.create({
    parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}`,
    requestBody: {
      name: tagName,
      type: 'html',
      parameter: [{ type: 'template', key: 'html', value: `<script>console.log('mcp test ${stamp}');</script>` }],
      firingTriggerId: [triggerId],
    },
  });
  const tagId = newTag.data.tagId as string;
  console.log(`Tag created: ${tagName} (ID: ${tagId})`);

  // Read
  const listVars = await tagmanager.accounts.containers.workspaces.variables.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  const listTrigs = await tagmanager.accounts.containers.workspaces.triggers.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  const listTags = await tagmanager.accounts.containers.workspaces.tags.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  console.log(`Read check -> variables: ${listVars.data.variable?.length || 0}, triggers: ${listTrigs.data.trigger?.length || 0}, tags: ${listTags.data.tag?.length || 0}`);

  // Update variable
  console.log('Updating variable code...');
  const existingVar = await tagmanager.accounts.containers.workspaces.variables.get({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/variables/${variableId}` });
  const varBody: any = { ...existingVar.data };
  varBody.parameter = varBody.parameter || [];
  const jsParam = varBody.parameter.find((p: any) => p.key === 'javascript');
  if (jsParam) jsParam.value = 'function() { return "hello_world_updated"; }';
  else varBody.parameter.push({ type: 'template', key: 'javascript', value: 'function() { return "hello_world_updated"; }' });
  await tagmanager.accounts.containers.workspaces.variables.update({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/variables/${variableId}`, requestBody: varBody });

  // Update trigger (rename)
  console.log('Updating trigger name...');
  const existingTrig = await tagmanager.accounts.containers.workspaces.triggers.get({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/triggers/${triggerId}` });
  const trigBody: any = { ...existingTrig.data, name: `${trigName}_updated` };
  await tagmanager.accounts.containers.workspaces.triggers.update({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/triggers/${triggerId}`, requestBody: trigBody });

  // Update tag (rename + html)
  console.log('Updating tag name and HTML...');
  const existingTag = await tagmanager.accounts.containers.workspaces.tags.get({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/tags/${tagId}` });
  const tagBody: any = { ...existingTag.data, name: `${tagName}_updated` };
  tagBody.parameter = tagBody.parameter || [];
  const htmlParam = tagBody.parameter.find((p: any) => p.key === 'html');
  if (htmlParam) htmlParam.value = `<script>console.log('mcp test ${stamp} - updated');</script>`;
  else tagBody.parameter.push({ type: 'template', key: 'html', value: `<script>console.log('mcp test ${stamp} - updated');</script>` });
  await tagmanager.accounts.containers.workspaces.tags.update({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/tags/${tagId}`, requestBody: tagBody });

  // Verify updates
  const updatedTrig = await tagmanager.accounts.containers.workspaces.triggers.get({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/triggers/${triggerId}` });
  console.log(`Updated trigger name: ${updatedTrig.data.name}`);

  // Cleanup: delete tag -> trigger -> variable
  console.log('Deleting created tag, trigger, variable...');
  await tagmanager.accounts.containers.workspaces.tags.delete({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/tags/${tagId}` });
  await tagmanager.accounts.containers.workspaces.triggers.delete({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/triggers/${triggerId}` });
  await tagmanager.accounts.containers.workspaces.variables.delete({ path: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}/variables/${variableId}` });

  const afterVars = await tagmanager.accounts.containers.workspaces.variables.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  const afterTrigs = await tagmanager.accounts.containers.workspaces.triggers.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  const afterTags = await tagmanager.accounts.containers.workspaces.tags.list({ parent: `accounts/${accountId}/containers/${containerId}/workspaces/${ws}` });
  console.log(`Cleanup check -> variables: ${afterVars.data.variable?.length || 0}, triggers: ${afterTrigs.data.trigger?.length || 0}, tags: ${afterTags.data.tag?.length || 0}`);

  console.log('GTM CRUD test completed successfully.');
}

main().catch((err) => {
  console.error('GTM CRUD test failed:', err.message || err);
  process.exit(1);
});

