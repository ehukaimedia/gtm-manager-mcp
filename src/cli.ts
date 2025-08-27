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
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.readonly',
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
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Saved tokens to ${TOKEN_PATH}`);
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
    default:
      console.log('Usage:');
      console.log('  npm run cli -- auth:url              # Print Google OAuth URL');
      console.log('  npm run cli -- auth:exchange <code>  # Exchange code for tokens');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
