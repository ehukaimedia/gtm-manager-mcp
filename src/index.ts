import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

// GTM API Configuration
const GTM_SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  'https://www.googleapis.com/auth/tagmanager.publish',
];

function loadDotEnv() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
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
  } catch {}
}

export class GTMManager {
  private auth?: OAuth2Client;
  private tagManager: any;
  private tokenPath: string;
  private accountId?: string;
  private containerId?: string;

  constructor() {
    // Token directory: prefer GTM_TOKEN_DIR, then project-local ./data, then module-local
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const defaultProjectData = path.join(process.cwd(), 'data');
    const moduleData = path.join(__dirname, '..', 'data');
    const dataDir = process.env.GTM_TOKEN_DIR || defaultProjectData || moduleData;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.tokenPath = path.join(dataDir, 'gtm-token.json');
    
    // Create OAuth2 client lazily to avoid startup failures when env is missing
    this.auth = undefined;

    // Try to load existing token
    this.loadToken();

    this.tagManager = google.tagmanager({ version: 'v2' });
  }
  status() {
    return {
      tokenPath: this.tokenPath,
      tokenExists: fs.existsSync(this.tokenPath),
      env: {
        GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID),
        GOOGLE_CLIENT_SECRET: Boolean(process.env.GOOGLE_CLIENT_SECRET),
        GOOGLE_REDIRECT_URI: Boolean(process.env.GOOGLE_REDIRECT_URI),
        GTM_ID: Boolean(process.env.GTM_ID),
        GTM_TOKEN_DIR: process.env.GTM_TOKEN_DIR || null,
      },
    };
  }

  getTokenMeta() {
    try {
      const raw = fs.readFileSync(this.tokenPath, 'utf-8');
      const tok = JSON.parse(raw || '{}');
      const scopesStr: string = tok.scope || tok.scopes || '';
      const scopes = typeof scopesStr === 'string' ? scopesStr.split(/\s+/).filter(Boolean) : Array.isArray(scopesStr) ? scopesStr : [];
      const expiryMs: number | undefined = tok.expiry_date || tok.expiry || undefined;
      return { scopes, expiry: expiryMs ? new Date(expiryMs).toISOString() : null };
    } catch {
      return { scopes: [], expiry: null };
    }
  }

  private ensureAuth(): OAuth2Client {
    if (this.auth) return this.auth;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI');
    }
    this.auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    this.tagManager = google.tagmanager({ version: 'v2', auth: this.auth });
    // Try to load existing token after auth client exists
    this.loadToken();
    return this.auth;
  }

  private loadToken() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
        if (this.auth) {
          this.auth.setCredentials(token);
        }
      }
    } catch (error) {
      console.error('Failed to load token:', error);
    }
  }

  private saveToken(token: any) {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
    } catch (e) {
      // Fallback if filesystem does not support POSIX perms
      fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2));
    }
  }

  async authenticate(code: string) {
    const auth = this.ensureAuth();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    this.saveToken(tokens);
    return tokens;
  }

  getAuthUrl(): string {
    const auth = this.ensureAuth();
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: GTM_SCOPES,
      prompt: 'consent'
    });
    return authUrl;
  }

  async findContainer(gtmId: string) {
    try {
      const accounts = await this.tagManager.accounts.list();
      
      for (const account of accounts.data.account || []) {
        const containers = await this.tagManager.accounts.containers.list({
          parent: `accounts/${account.accountId}`
        });
        
        const container = containers.data.container?.find(
          (c: any) => c.publicId === gtmId
        );
        
        if (container) {
          this.accountId = account.accountId;
          this.containerId = container.containerId;
          return { account, container };
        }
      }
      
      throw new Error(`Container ${gtmId} not found`);
    } catch (error: any) {
      throw new Error(`Failed to find container: ${error.message}`);
    }
  }

  async loadConfigGtmId(configPath: string): Promise<string> {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.seo?.gtmId || process.env.GTM_ID || '';
    } catch (error) {
      return process.env.GTM_ID || '';
    }
  }

  async listTags() {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const tags = await this.tagManager.accounts.containers.workspaces.tags.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`
    });

    return tags.data.tag || [];
  }

  async listVariables() {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const variables = await this.tagManager.accounts.containers.workspaces.variables.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`
    });

    return variables.data.variable || [];
  }

  async findTagsByName(query: string) {
    const gtmId = process.env.GTM_ID;
    if (!this.accountId || !this.containerId) {
      if (!gtmId) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(gtmId);
    }
    const tags = await this.listTags();
    const q = query.toLowerCase();
    return (tags || []).filter((t: any) => String(t.name || '').toLowerCase().includes(q));
  }

  async findTriggersByName(query: string) {
    const gtmId = process.env.GTM_ID;
    if (!this.accountId || !this.containerId) {
      if (!gtmId) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(gtmId);
    }
    const triggers = await this.listTriggers();
    const q = query.toLowerCase();
    return (triggers || []).filter((t: any) => String(t.name || '').toLowerCase().includes(q));
  }

  async findVariablesByName(query: string, exact?: boolean) {
    const gtmId = process.env.GTM_ID;
    if (!this.accountId || !this.containerId) {
      if (!gtmId) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(gtmId);
    }
    const variables = await this.listVariables();
    const q = query.toLowerCase();
    return (variables || []).filter((v: any) => {
      const name = String(v.name || '');
      return exact ? name === query : name.toLowerCase().includes(q);
    });
  }

  async validateWorkspace() {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }
    const [tags, variables, triggers] = await Promise.all([
      this.listTags(),
      this.listVariables(),
      this.listTriggers(),
    ]);
    const varNames = new Set((variables || []).map((v: any) => String(v.name || '')));
    const triggerIds = new Set((triggers || []).map((t: any) => String(t.triggerId || '')));
    const issues: string[] = [];

    for (const tag of (tags as any[])) {
      const p = (tag.parameter || []) as any[];
      if (Array.isArray(tag.firingTriggerId)) {
        for (const tid of tag.firingTriggerId) {
          if (tid && !triggerIds.has(String(tid))) issues.push(`Tag '${tag.name}' references missing trigger ${tid}`);
        }
      }
      if (tag.type === 'gaawe') {
        const hasSendTo = p.some((x) => x.key === 'sendToTag');
        const hasMid = p.some((x) => x.key === 'measurementId');
        const hasMidOverride = p.some((x) => x.key === 'measurementIdOverride');
        if (!hasSendTo && !hasMid && !hasMidOverride) {
          issues.push(`GA4 Event '${tag.name}' missing configTagId/measurementId`);
        }
      }
      const evp = p.find((x) => x.key === 'eventParameters');
      if (evp && Array.isArray(evp.list)) {
        for (const m of evp.list as any[]) {
          const valueEntry = (m.map || []).find((e: any) => e.key === 'value');
          const val = valueEntry?.value as string | undefined;
          const macro = val && /\{\{([^}]+)\}\}/.exec(val);
          if (macro && !varNames.has(macro[1])) {
            issues.push(`Tag '${tag.name}' references unknown variable '{{${macro[1]}}}'`);
          }
        }
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async createTag(name: string, html: string, triggerType: string = 'pageview') {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    // Create trigger if needed
    let triggerId;
    if (triggerType === 'pageview') {
      const triggers = await this.tagManager.accounts.containers.workspaces.triggers.list({
        parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`
      });

      let allPagesTrigger = triggers.data.trigger?.find((t: any) => t.type === 'pageview');
      
      if (!allPagesTrigger) {
        const newTrigger = await this.tagManager.accounts.containers.workspaces.triggers.create({
          parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
          requestBody: {
            name: 'All Pages',
            type: 'pageview'
          }
        });
        triggerId = newTrigger.data.triggerId;
      } else {
        triggerId = allPagesTrigger.triggerId;
      }
    }

    // Create tag
    const tag = await this.tagManager.accounts.containers.workspaces.tags.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type: 'html',
        parameter: [
          {
            type: 'template',
            key: 'html',
            value: html
          }
        ],
        firingTriggerId: triggerId ? [triggerId] : undefined
      }
    });

    return tag.data;
  }

  async createGa4ConfigurationTag(
    name: string,
    measurementId: string,
    options?: { sendPageView?: boolean; triggerType?: string; fieldsToSet?: Record<string, string> }
  ) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`,
    });
    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    let triggerId: string | undefined = (options as any)?.triggerId;
    const triggerType = options?.triggerType || 'pageview';
    if (!triggerId && triggerType === 'pageview') {
      const triggers = await this.tagManager.accounts.containers.workspaces.triggers.list({
        parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      });
      let allPagesTrigger = triggers.data.trigger?.find((t: any) => t.type === 'pageview');
      if (!allPagesTrigger) {
        const newTrigger = await this.tagManager.accounts.containers.workspaces.triggers.create({
          parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
          requestBody: { name: 'All Pages', type: 'pageview' },
        });
        triggerId = newTrigger.data.triggerId as string;
      } else {
        triggerId = allPagesTrigger.triggerId as string;
      }
    }

    const params: any[] = [
      { type: 'template', key: 'measurementId', value: measurementId },
    ];
    if (typeof options?.sendPageView === 'boolean') {
      params.push({ type: 'boolean', key: 'sendPageView', value: options.sendPageView ? 'true' : 'false' });
    }
    if (options?.fieldsToSet && Object.keys(options.fieldsToSet).length > 0) {
      params.push({
        type: 'list',
        key: 'fieldsToSet',
        list: Object.entries(options.fieldsToSet).map(([k, v]) => ({
          type: 'map',
          map: [
            { type: 'template', key: 'name', value: k },
            { type: 'template', key: 'value', value: String(v) },
          ],
        })),
      });
    }

    const tag = await this.tagManager.accounts.containers.workspaces.tags.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type: 'gaawc',
        parameter: params,
        firingTriggerId: triggerId ? [triggerId] : undefined,
      },
    });

    return tag.data;
  }

  async createGa4EventTag(
    name: string,
    measurementId: string | undefined,
    eventName: string,
    options?: { configTagId?: string; eventParameters?: Record<string, any>; triggerType?: string; triggerId?: string; resolveVariables?: boolean }
  ) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`,
    });
    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    let triggerId: string | undefined = options?.triggerId;
    const triggerType = options?.triggerType || 'pageview';
    if (!triggerId && triggerType === 'pageview') {
      const triggers = await this.tagManager.accounts.containers.workspaces.triggers.list({
        parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      });
      let allPagesTrigger = triggers.data.trigger?.find((t: any) => t.type === 'pageview');
      if (!allPagesTrigger) {
        const newTrigger = await this.tagManager.accounts.containers.workspaces.triggers.create({
          parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
          requestBody: { name: 'All Pages', type: 'pageview' },
        });
        triggerId = newTrigger.data.triggerId as string;
      } else {
        triggerId = allPagesTrigger.triggerId as string;
      }
    }

    const params: any[] = [
      { type: 'template', key: 'eventName', value: eventName },
    ];
    if (options?.configTagId) {
      // Link event to an existing GA4 Configuration tag. Vendor key is sendToTag.
      params.push({ type: 'tagReference', key: 'sendToTag', value: options.configTagId });
    } else if (measurementId) {
      params.push({ type: 'template', key: 'measurementId', value: measurementId });
      params.push({
        type: 'list',
        key: 'measurementIdOverride',
        list: [ { type: 'template', value: measurementId } ],
      });
    } else {
      throw new Error('Either configTagId or measurementId is required');
    }
    if (options?.eventParameters && Object.keys(options.eventParameters).length > 0) {
      const variables = options.resolveVariables ? await this.listVariables() : [];
      const varById = new Map<string, any>();
      const varByName = new Map<string, any>();
      for (const v of variables as any[]) {
        if (v.variableId) varById.set(String(v.variableId), v);
        if (v.name) varByName.set(String(v.name), v);
      }
      const list = Object.entries(options.eventParameters).map(([k, spec]) => {
        let valueStr: string;
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
          if ('value' in spec) {
            valueStr = String((spec as any).value);
          } else if ('varId' in spec) {
            const vv = varById.get(String((spec as any).varId));
            valueStr = vv ? `{{${vv.name}}}` : `{{${(spec as any).varId}}}`;
          } else if ('var' in spec) {
            const vv = varByName.get(String((spec as any).var));
            valueStr = vv ? `{{${vv.name}}}` : `{{${(spec as any).var}}}`;
          } else {
            valueStr = String(spec as any);
          }
        } else {
          valueStr = String(spec as any);
        }
        return {
          type: 'map',
          map: [
            { type: 'template', key: 'name', value: k },
            { type: 'template', key: 'value', value: valueStr },
          ],
        };
      });
      params.push({ type: 'list', key: 'eventParameters', list });
    }

    const tag = await this.tagManager.accounts.containers.workspaces.tags.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type: 'gaawe',
        parameter: params,
        firingTriggerId: triggerId ? [triggerId] : undefined,
      },
    });

    return tag.data;
  }


  async deleteTag(tagId: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    await this.tagManager.accounts.containers.workspaces.tags.delete({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${tagId}`
    });

    return { deleted: true, tagId };
  }

  async createVariable(name: string, code: string, type: string = 'jsm') {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    // Create variable
    const variable = await this.tagManager.accounts.containers.workspaces.variables.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type,
        parameter: [
          {
            type: 'template',
            key: 'javascript',
            value: code
          }
        ]
      }
    });

    return variable.data;
  }

  async createDataLayerVariable(name: string, dlvName: string, dataLayerVersion: 1 | 2 = 2, defaultValue?: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const parameter: any[] = [
      { type: 'template', key: 'name', value: dlvName },
      { type: 'template', key: 'dataLayerVersion', value: String(dataLayerVersion) },
    ];
    if (typeof defaultValue === 'string' && defaultValue.length > 0) {
      parameter.push({ type: 'template', key: 'defaultValue', value: defaultValue });
    }

    const variable = await this.tagManager.accounts.containers.workspaces.variables.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type: 'v',
        parameter,
      }
    });

    return variable.data;
  }

  async deleteVariable(variableId: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    await this.tagManager.accounts.containers.workspaces.variables.delete({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/variables/${variableId}`
    });

    return { deleted: true, variableId };
  }

  async updateTag(tagId: string, name?: string, html?: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    // Get existing tag
    const existingTag = await this.tagManager.accounts.containers.workspaces.tags.get({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${tagId}`
    });

    // Update tag
    const updateBody: any = { ...existingTag.data };
    if (name) updateBody.name = name;
    if (html) {
      updateBody.parameter = updateBody.parameter || [];
      const htmlParam = updateBody.parameter.find((p: any) => p.key === 'html');
      if (htmlParam) {
        htmlParam.value = html;
      } else {
        updateBody.parameter.push({
          type: 'template',
          key: 'html',
          value: html
        });
      }
    }

    const updated = await this.tagManager.accounts.containers.workspaces.tags.update({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${tagId}`,
      requestBody: updateBody
    });

    return updated.data;
  }

  async pauseTag(tagId: string, paused: boolean) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });
    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const existingTag = await this.tagManager.accounts.containers.workspaces.tags.get({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${tagId}`
    });

    const updateBody: any = { ...existingTag.data, paused };
    const updated = await this.tagManager.accounts.containers.workspaces.tags.update({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${tagId}`,
      requestBody: updateBody,
    });
    return updated.data;
  }

  async updateGa4EventTag(
    tagId: string,
    updates: {
      name?: string;
      configTagId?: string;
      measurementId?: string;
      eventName?: string;
      eventParameters?: Record<string, any>;
      triggerId?: string;
      triggerType?: string;
      resolveVariables?: boolean;
    }
  ) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });
    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const getPath = (id: string) => `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/tags/${id}`;
    const existing = await this.tagManager.accounts.containers.workspaces.tags.get({ path: getPath(tagId) });
    const body: any = { ...existing.data };
    body.parameter = Array.isArray(body.parameter) ? body.parameter : [];

    if (updates.name) body.name = updates.name;
    if (updates.eventName) {
      let p = body.parameter.find((x: any) => x.key === 'eventName');
      if (p) p.value = updates.eventName; else body.parameter.push({ type: 'template', key: 'eventName', value: updates.eventName });
    }

    // Config linkage vs measurementId
    if (updates.configTagId) {
      // Ensure sendToTag present, remove measurementId/override
      let st = body.parameter.find((x: any) => x.key === 'sendToTag');
      if (st) { st.type = 'tagReference'; st.value = updates.configTagId; }
      else body.parameter.push({ type: 'tagReference', key: 'sendToTag', value: updates.configTagId });
      body.parameter = body.parameter.filter((x: any) => x.key !== 'measurementId' && x.key !== 'measurementIdOverride');
    } else if (updates.measurementId) {
      let mid = body.parameter.find((x: any) => x.key === 'measurementId');
      if (mid) mid.value = updates.measurementId; else body.parameter.push({ type: 'template', key: 'measurementId', value: updates.measurementId });
      // override as list
      let over = body.parameter.find((x: any) => x.key === 'measurementIdOverride');
      if (over) { over.type = 'list'; over.list = [{ type: 'template', value: updates.measurementId }]; }
      else body.parameter.push({ type: 'list', key: 'measurementIdOverride', list: [{ type: 'template', value: updates.measurementId }] });
      // remove sendToTag if switching away
      body.parameter = body.parameter.filter((x: any) => x.key !== 'sendToTag');
    }

    // Update eventParameters if provided
    if (updates.eventParameters) {
      let variables: any[] = [];
      if (updates.resolveVariables) variables = await this.listVariables() as any[];
      const varById = new Map<string, any>();
      const varByName = new Map<string, any>();
      for (const v of variables) { if (v.variableId) varById.set(String(v.variableId), v); if (v.name) varByName.set(String(v.name), v); }
      const list = Object.entries(updates.eventParameters).map(([k, spec]) => {
        let valueStr: string;
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
          if ('value' in spec) valueStr = String((spec as any).value);
          else if ('varId' in spec) { const vv = varById.get(String((spec as any).varId)); valueStr = vv ? `{{${vv.name}}}` : `{{${(spec as any).varId}}}`; }
          else if ('var' in spec) { const vv = varByName.get(String((spec as any).var)); valueStr = vv ? `{{${vv.name}}}` : `{{${(spec as any).var}}}`; }
          else valueStr = String(spec as any);
        } else valueStr = String(spec as any);
        return { type: 'map', map: [ { type: 'template', key: 'name', value: k }, { type: 'template', key: 'value', value: valueStr } ] };
      });
      let evp = body.parameter.find((x: any) => x.key === 'eventParameters');
      if (evp) { evp.type = 'list'; evp.list = list; }
      else body.parameter.push({ type: 'list', key: 'eventParameters', list });
    }

    // Update triggers
    if (updates.triggerId) {
      body.firingTriggerId = [updates.triggerId];
    } else if (updates.triggerType === 'pageview') {
      // ensure All Pages exists
      const work = await this.tagManager.accounts.containers.workspaces.triggers.list({ parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}` });
      let all = (work.data.trigger || []).find((t: any) => t.type === 'pageview');
      if (!all) {
        const newt = await this.tagManager.accounts.containers.workspaces.triggers.create({ parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}` , requestBody: { name: 'All Pages', type: 'pageview' }});
        body.firingTriggerId = [newt.data.triggerId];
      } else body.firingTriggerId = [all.triggerId];
    }

    const updated = await this.tagManager.accounts.containers.workspaces.tags.update({ path: getPath(tagId), requestBody: body });
    return updated.data;
  }

  async updateVariable(variableId: string, name?: string, code?: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    // Get existing variable
    const existingVariable = await this.tagManager.accounts.containers.workspaces.variables.get({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/variables/${variableId}`
    });

    // Update variable
    const updateBody: any = { ...existingVariable.data };
    if (name) updateBody.name = name;
    if (code) {
      updateBody.parameter = updateBody.parameter || [];
      const jsParam = updateBody.parameter.find((p: any) => p.key === 'javascript');
      if (jsParam) {
        jsParam.value = code;
      } else {
        updateBody.parameter.push({
          type: 'template',
          key: 'javascript',
          value: code
        });
      }
    }

    const updated = await this.tagManager.accounts.containers.workspaces.variables.update({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/variables/${variableId}`,
      requestBody: updateBody
    });

    return updated.data;
  }

  async listTriggers() {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const triggers = await this.tagManager.accounts.containers.workspaces.triggers.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`
    });

    return triggers.data.trigger || [];
  }

  async createTrigger(name: string, type: string, conditions?: any[]) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const trigger = await this.tagManager.accounts.containers.workspaces.triggers.create({
      parent: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        type,
        filter: conditions
      }
    });

    return trigger.data;
  }

  async deleteTrigger(triggerId: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });

    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    await this.tagManager.accounts.containers.workspaces.triggers.delete({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}/triggers/${triggerId}`
    });

    return { deleted: true, triggerId };
  }

  async createVersion(name?: string, notes?: string) {
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const workspaces = await this.tagManager.accounts.containers.workspaces.list({
      parent: `accounts/${this.accountId}/containers/${this.containerId}`
    });
    const workspace = workspaces.data.workspace?.[0];
    if (!workspace) throw new Error('No workspace found');

    const resp = await this.tagManager.accounts.containers.workspaces.create_version({
      path: `accounts/${this.accountId}/containers/${this.containerId}/workspaces/${workspace.workspaceId}`,
      requestBody: {
        name,
        notes,
      },
    });

    const version = (resp as any).data?.containerVersion || (resp as any).data;
    const versionId = version?.containerVersionId;
    return { versionId, version };
  }

  async publishVersion(versionId: string) {
    if (!versionId) throw new Error('versionId is required');
    if (!this.accountId || !this.containerId) {
      if (!process.env.GTM_ID) throw new Error('GTM_ID environment variable not set');
      this.ensureAuth();
      await this.findContainer(process.env.GTM_ID);
    }

    this.ensureAuth();
    const resp = await this.tagManager.accounts.containers.versions.publish({
      path: `accounts/${this.accountId}/containers/${this.containerId}/versions/${versionId}`,
    });
    return resp.data;
  }

  async submit(name?: string, notes?: string) {
    const { versionId, version } = await this.createVersion(name, notes);
    if (!versionId) throw new Error('Failed to create version');
    const published = await this.publishVersion(versionId);
    return { versionId, version, published };
  }
}

// Create MCP Server
const server = new Server(
  {
    name: 'gtm-manager',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

loadDotEnv();
const gtmManager = new GTMManager();

// Define available tools
const TOOLS: Tool[] = [
  {
    name: 'gtm_health',
    description: 'Check server health and environment readiness',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gtm_auth',
    description: 'Get authentication URL for GTM access',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'gtm_authenticate',
    description: 'Authenticate with GTM using authorization code',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Authorization code from Google OAuth',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'gtm_list_tags',
    description: 'List all tags in the GTM container',
    inputSchema: {
      type: 'object',
      properties: {
        gtmId: {
          type: 'string',
          description: 'GTM container ID (optional, uses env default)',
        },
        format: { type: 'string', description: "'json' for JSON output" },
        idsOnly: { type: 'boolean', description: 'Return IDs only', default: false },
      },
    },
  },
  {
    name: 'gtm_list_variables',
    description: 'List all variables in the GTM container',
    inputSchema: {
      type: 'object',
      properties: {
        gtmId: {
          type: 'string',
          description: 'GTM container ID (optional, uses env default)',
        },
        format: { type: 'string', description: "'json' for JSON output" },
        idsOnly: { type: 'boolean', description: 'Return IDs only', default: false },
      },
    },
  },
  {
    name: 'gtm_find_tags',
    description: 'Find tags by name substring (case-insensitive)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or substring to search for' },
        gtmId: { type: 'string', description: 'GTM container ID (optional, uses env default)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'gtm_find_triggers',
    description: 'Find triggers by name substring (case-insensitive)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or substring to search for' },
        gtmId: { type: 'string', description: 'GTM container ID (optional, uses env default)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'gtm_create_tag',
    description: 'Create a new HTML tag in GTM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Tag name',
        },
        html: {
          type: 'string',
          description: 'HTML/JavaScript code for the tag',
        },
        trigger: {
          type: 'string',
          description: 'Trigger type (default: pageview)',
          default: 'pageview',
        },
      },
      required: ['name', 'html'],
    },
  },
  {
    name: 'gtm_create_ga4_configuration',
    description: 'Create a native GA4 Configuration tag',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name' },
        measurementId: { type: 'string', description: 'GA4 Measurement ID (e.g., G-XXXXXXX)' },
        sendPageView: { type: 'boolean', description: 'Send a page_view on load', default: true },
        trigger: { type: 'string', description: 'Trigger type (default: pageview)', default: 'pageview' },
        fieldsToSet: { type: 'object', description: 'Additional fields to set (name -> value)' },
      },
      required: ['name', 'measurementId'],
    },
  },
  {
    name: 'gtm_create_ga4_event',
    description: 'Create a native GA4 Event tag',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name' },
        measurementId: { type: 'string', description: 'GA4 Measurement ID (e.g., G-XXXXXXX) — optional if configTagId is provided' },
        configTagId: { type: 'string', description: 'GA4 Configuration tag ID to link (preferred for Google tag containers)' },
        eventName: { type: 'string', description: 'GA4 event name (e.g., page_view, purchase)' },
        eventParameters: { type: 'object', description: 'Event parameters (key -> value)' },
        trigger: { type: 'string', description: 'Trigger type (default: pageview)', default: 'pageview' },
        triggerId: { type: 'string', description: 'Explicit Trigger ID to use' },
      },
      required: ['name', 'eventName'],
    },
  },
  {
    name: 'gtm_delete_tag',
    description: 'Delete a tag from GTM',
    inputSchema: {
      type: 'object',
      properties: {
        tagId: {
          type: 'string',
          description: 'Tag ID to delete',
        },
      },
      required: ['tagId'],
    },
  },
  {
    name: 'gtm_create_variable',
    description: 'Create a new Custom JavaScript variable in GTM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Variable name',
        },
        code: {
          type: 'string',
          description: 'JavaScript code for the variable',
        },
        type: {
          type: 'string',
          description: 'Variable type (default: jsm for Custom JavaScript)',
          default: 'jsm',
        },
      },
      required: ['name', 'code'],
    },
  },
  {
    name: 'gtm_create_dlv',
    description: 'Create a new Data Layer Variable (DLV) in GTM',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Variable display name' },
        dlvName: { type: 'string', description: 'Data Layer key (e.g., page.path)' },
        dataLayerVersion: { type: 'number', description: 'Data layer version (1 or 2)', default: 2 },
        defaultValue: { type: 'string', description: 'Default value when key missing (optional)' },
      },
      required: ['name', 'dlvName'],
    },
  },
  {
    name: 'gtm_find_variables',
    description: 'Find variables by name substring (case-insensitive)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or substring to search for' },
        exact: { type: 'boolean', description: 'Require exact match', default: false },
        idsOnly: { type: 'boolean', description: 'Return IDs only', default: false },
        gtmId: { type: 'string', description: 'GTM container ID (optional, uses env default)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'gtm_validate_workspace',
    description: 'Validate the current workspace for common blocking issues before publish',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gtm_delete_variable',
    description: 'Delete a variable from GTM',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: {
          type: 'string',
          description: 'Variable ID to delete',
        },
      },
      required: ['variableId'],
    },
  },
  {
    name: 'gtm_update_tag',
    description: 'Update an existing tag',
    inputSchema: {
      type: 'object',
      properties: {
        tagId: {
          type: 'string',
          description: 'Tag ID to update',
        },
        name: {
          type: 'string',
          description: 'New tag name (optional)',
        },
        html: {
          type: 'string',
          description: 'New HTML/JavaScript content (optional)',
        },
      },
      required: ['tagId'],
    },
  },
  {
    name: 'gtm_update_variable',
    description: 'Update an existing variable',
    inputSchema: {
      type: 'object',
      properties: {
        variableId: {
          type: 'string',
          description: 'Variable ID to update',
        },
        name: {
          type: 'string',
          description: 'New variable name (optional)',
        },
        code: {
          type: 'string',
          description: 'New JavaScript code (optional)',
        },
      },
      required: ['variableId'],
    },
  },
  {
    name: 'gtm_update_ga4_event_tag',
    description: 'Update a GA4 Event tag in place (name, linkage, triggers, parameters)',
    inputSchema: {
      type: 'object',
      properties: {
        tagId: { type: 'string', description: 'GA4 Event tag ID' },
        name: { type: 'string', description: 'New tag name (optional)' },
        configTagId: { type: 'string', description: 'GA4 Configuration tag ID to link (sendToTag)' },
        measurementId: { type: 'string', description: 'Measurement ID (used if no configTagId)' },
        eventName: { type: 'string', description: 'GA4 event name (optional)' },
        eventParameters: { type: 'object', description: 'Event parameters (supports {value}|{var}|{varId})' },
        triggerId: { type: 'string', description: 'Trigger ID to use (optional)' },
        trigger: { type: 'string', description: 'Trigger type (e.g., pageview) if not using triggerId' },
        resolveVariables: { type: 'boolean', description: 'Resolve variable names/IDs in eventParameters', default: false },
      },
      required: ['tagId'],
    },
  },
  {
    name: 'gtm_pause_tag',
    description: 'Pause a tag (non-destructive)',
    inputSchema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] },
  },
  {
    name: 'gtm_unpause_tag',
    description: 'Unpause a tag',
    inputSchema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] },
  },
  {
    name: 'gtm_list_versions',
    description: 'List container versions (name, notes, created time)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gtm_create_custom_event_trigger',
    description: 'Create a Custom Event trigger with optional regex filter',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trigger name' },
        eventName: { type: 'string', description: 'Data Layer event name (e.g., login)' },
        regex: { type: 'boolean', description: 'Treat eventName as regex (optional)', default: false },
      },
      required: ['name', 'eventName'],
    },
  },
  {
    name: 'gtm_list_triggers',
    description: 'List all triggers in the GTM container',
    inputSchema: {
      type: 'object',
      properties: {
        gtmId: {
          type: 'string',
          description: 'GTM container ID (optional, uses env default)',
        },
        format: { type: 'string', description: "'json' for JSON output" },
        idsOnly: { type: 'boolean', description: 'Return IDs only', default: false },
      },
    },
  },
  {
    name: 'gtm_health_plus',
    description: 'Detailed health: token scopes/expiry, container/workspace, publishability',
    inputSchema: { type: 'object', properties: { format: { type: 'string', description: "'json' for JSON output" } } },
  },
  {
    name: 'gtm_pause_tags_by_name',
    description: 'Pause tags by name substring (supports exact + dryRun)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name or substring to match' },
        exact: { type: 'boolean', description: 'Exact match' },
        dryRun: { type: 'boolean', description: 'Do not modify, only list matches' },
        gtmId: { type: 'string', description: 'Override GTM ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'gtm_unpause_tags_by_ids',
    description: 'Unpause tags by IDs',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', description: 'Tag IDs', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'gtm_create_trigger',
    description: 'Create a new trigger',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Trigger name',
        },
        type: {
          type: 'string',
          description: 'Trigger type (pageview, click, formSubmit, etc.)',
        },
        conditions: {
          type: 'array',
          description: 'Trigger conditions (optional)',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'gtm_delete_trigger',
    description: 'Delete a trigger from GTM',
    inputSchema: {
      type: 'object',
      properties: {
        triggerId: {
          type: 'string',
          description: 'Trigger ID to delete',
        },
      },
      required: ['triggerId'],
    },
  },
  {
    name: 'gtm_create_version',
    description: 'Create a container version from the active workspace',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Version name (optional)' },
        notes: { type: 'string', description: 'Version notes (optional)' },
      },
    },
  },
  {
    name: 'gtm_publish_version',
    description: 'Publish a specific container version',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { type: 'string', description: 'Container version ID' },
      },
      required: ['versionId'],
    },
  },
  {
    name: 'gtm_submit',
    description: 'Create a version from the workspace and publish it',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Version name (optional)' },
        notes: { type: 'string', description: 'Version notes (optional)' },
      },
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'gtm_health': {
        const s = gtmManager.status();
        const ok = s.env.GOOGLE_CLIENT_ID && s.env.GOOGLE_CLIENT_SECRET && s.env.GOOGLE_REDIRECT_URI;
        return {
          content: [
            {
              type: 'text',
              text: `ok=${ok}\nToken: ${s.tokenExists ? 'present' : 'missing'}\nToken path: ${s.tokenPath}\nEnv: client=${s.env.GOOGLE_CLIENT_ID} secret=${s.env.GOOGLE_CLIENT_SECRET} redirect=${s.env.GOOGLE_REDIRECT_URI} gtmId=${s.env.GTM_ID} tokenDir=${s.env.GTM_TOKEN_DIR || ''}`,
            },
          ],
        };
      }
      case 'gtm_auth':
        const authUrl = gtmManager.getAuthUrl();
        return {
          content: [
            {
              type: 'text',
              text: `Visit this URL to authenticate:\n${authUrl}\n\nAfter authorization, you'll get a code. Use gtm_authenticate with that code.`,
            },
          ],
        };

      case 'gtm_authenticate':
        if (!args?.code) throw new Error('Authorization code is required');
        await gtmManager.authenticate(args.code as string);
        return {
          content: [
            {
              type: 'text',
              text: 'Successfully authenticated with Google Tag Manager!',
            },
          ],
        };

      case 'gtm_list_tags':
        const gtmId = (args?.gtmId as string) || process.env.GTM_ID;
        if (!gtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmId);
        const tags = await gtmManager.listTags();
        if (args?.format === 'json') {
          const items = (tags || []).map((tag: any) => ({ id: tag.tagId, name: tag.name, type: tag.type, paused: !!tag.paused }));
          return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, items }, null, 2) }] };
        }
        if (args?.idsOnly) {
          return { content: [{ type: 'text', text: (tags || []).map((t: any) => t.tagId).join('\n') }] };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Found ${tags.length} tags:\n${tags
                .map((tag: any) => {
                  const typeMap: Record<string,string> = { gaawe: 'GA4 Event', gaawc: 'GA4 Config', html: 'Custom HTML' };
                  const friendly = typeMap[tag.type] || tag.type;
                  const paused = tag.paused ? ' (paused)' : '';
                  return `- ${tag.name}${paused} [${friendly}] - ID: ${tag.tagId}`;
                })
                .join('\n')}`,
            },
          ],
        };

      case 'gtm_list_variables':
        const varGtmId = (args?.gtmId as string) || process.env.GTM_ID;
        if (!varGtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(varGtmId);
        const variables = await gtmManager.listVariables();
        if (args?.format === 'json') {
          const items = (variables || []).map((v: any) => ({ id: v.variableId, name: v.name, type: v.type }));
          return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, items }, null, 2) }] };
        }
        if (args?.idsOnly) {
          return { content: [{ type: 'text', text: (variables || []).map((v: any) => v.variableId).join('\n') }] };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Found ${variables.length} variables:\n${variables
                .map((variable: any) => {
                  const typeMap: Record<string,string> = { jsm: 'Custom JS', v: 'Data Layer Var' };
                  const friendly = typeMap[variable.type] || variable.type;
                  return `- ${variable.name} [${friendly}] - ID: ${variable.variableId}`;
                })
                .join('\n')}`,
            },
          ],
        };

      case 'gtm_find_tags': {
        const gtmIdFind = (args?.gtmId as string) || process.env.GTM_ID;
        if (!gtmIdFind) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmIdFind);
        const nameQ = String(args?.name || '').trim();
        if (!nameQ) throw new Error('name is required');
        const exact = Boolean(args?.exact);
        const idsOnly = Boolean(args?.idsOnly);
        let matches = await gtmManager.findTagsByName(nameQ);
        if (exact) matches = matches.filter((t: any) => String(t.name || '') === nameQ);
        return {
          content: [
            {
              type: 'text',
              text: idsOnly
                ? matches.map((t: any) => t.tagId).join('\n')
                : (matches.length
                  ? `Found ${matches.length} tag(s):\n${matches.map((t: any) => `- ${t.name} (${t.type}) - ID: ${t.tagId}`).join('\n')}`
                  : `No tags matched \"${nameQ}\"`),
            },
          ],
        };
      }

      case 'gtm_find_triggers': {
        const gtmIdFind = (args?.gtmId as string) || process.env.GTM_ID;
        if (!gtmIdFind) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmIdFind);
        const nameQ = String(args?.name || '').trim();
        if (!nameQ) throw new Error('name is required');
        const exact = Boolean(args?.exact);
        const idsOnly = Boolean(args?.idsOnly);
        let matches = await gtmManager.findTriggersByName(nameQ);
        if (exact) matches = matches.filter((t: any) => String(t.name || '') === nameQ);
        return {
          content: [
            {
              type: 'text',
              text: idsOnly
                ? matches.map((t: any) => t.triggerId).join('\n')
                : (matches.length
                  ? `Found ${matches.length} trigger(s):\n${matches.map((t: any) => `- ${t.name} (${t.type}) - ID: ${t.triggerId}`).join('\n')}`
                  : `No triggers matched \"${nameQ}\"`),
            },
          ],
        };
      }

      case 'gtm_health_plus': {
        const status = gtmManager.status();
        const token = status.tokenExists ? gtmManager.getTokenMeta() : { scopes: [], expiry: null };
        let containerPath = '';
        let workspaceId: string | null = null;
        let containerOk = false;
        try {
          const gtmIdEnv = process.env.GTM_ID;
          if (gtmIdEnv) {
            await gtmManager.findContainer(gtmIdEnv);
            const workspaces = await (gtmManager as any).tagManager.accounts.containers.workspaces.list({ parent: `accounts/${(gtmManager as any).accountId}/containers/${(gtmManager as any).containerId}` });
            workspaceId = workspaces?.data?.workspace?.[0]?.workspaceId || null;
            containerPath = `accounts/${(gtmManager as any).accountId}/containers/${(gtmManager as any).containerId}`;
            containerOk = true;
          }
        } catch {}
        const requiredScopes = [
          'https://www.googleapis.com/auth/tagmanager.readonly',
          'https://www.googleapis.com/auth/tagmanager.edit.containers',
          'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
          'https://www.googleapis.com/auth/tagmanager.publish',
        ];
        const missingScopes = requiredScopes.filter((s) => !(token.scopes || []).includes(s));
        const publishable = missingScopes.length === 0 && containerOk;
        const out = {
          ok: status.env.GOOGLE_CLIENT_ID && status.env.GOOGLE_CLIENT_SECRET && status.env.GOOGLE_REDIRECT_URI,
          tokenPresent: status.tokenExists,
          scopes: token.scopes,
          tokenExpiry: (token as any).expiry || null,
          containerPath,
          workspaceId,
          publishable,
          missingScopes,
        };
        if (args?.format === 'json') return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
        return { content: [{ type: 'text', text: `ok=${out.ok}\ntoken=${out.tokenPresent}\nscopes=${out.scopes.join(', ')}\nexpiry=${out.tokenExpiry || ''}\ncontainer=${out.containerPath || ''}\nworkspace=${out.workspaceId || ''}\npublishable=${out.publishable}\nmissingScopes=${out.missingScopes.join(', ')}` }] };
      }

      case 'gtm_pause_tags_by_name': {
        const gtmIdFind2 = (args?.gtmId as string) || process.env.GTM_ID;
        if (!gtmIdFind2) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmIdFind2);
        const nameQ2 = String(args?.name || '').trim();
        if (!nameQ2) throw new Error('name is required');
        const exact2 = Boolean(args?.exact);
        const dry2 = Boolean(args?.dryRun);
        let matches2 = await gtmManager.findTagsByName(nameQ2);
        if (exact2) matches2 = matches2.filter((t: any) => String(t.name || '') === nameQ2);
        if (dry2) {
          return { content: [{ type: 'text', text: matches2.map((t: any) => `${t.tagId}\t${t.name}`).join('\n') || '(no matches)' }] };
        }
        const results2: string[] = [];
        for (const t of matches2 as any[]) {
          const upd = await gtmManager.pauseTag(String(t.tagId), true);
          results2.push(`${upd.tagId}\tpaused`);
        }
        return { content: [{ type: 'text', text: results2.join('\n') || '(no matches)' }] };
      }

      case 'gtm_unpause_tags_by_ids': {
        const ids2 = Array.isArray(args?.ids) ? (args.ids as string[]) : [];
        if (ids2.length === 0) throw new Error('ids array is required');
        const out2: string[] = [];
        for (const id of ids2) {
          const upd = await gtmManager.pauseTag(String(id), false);
          out2.push(`${upd.tagId}\tunpaused`);
        }
        return { content: [{ type: 'text', text: out2.join('\n') }] };
      }

      case 'gtm_create_tag':
        if (!args?.name || !args?.html) throw new Error('Tag name and HTML are required');
        const newTag = await gtmManager.createTag(
          args.name as string, 
          args.html as string, 
          (args.trigger as string) || 'pageview'
        );
        return {
          content: [
            {
              type: 'text',
              text: `Tag created successfully!\nName: ${newTag.name}\nID: ${newTag.tagId}`,
            },
          ],
        };


      case 'gtm_delete_tag':
        if (!args?.tagId) throw new Error('Tag ID is required');
        const result = await gtmManager.deleteTag(args.tagId as string);
        return {
          content: [
            {
              type: 'text',
              text: `Tag ${result.tagId} deleted successfully!`,
            },
          ],
        };

      case 'gtm_create_ga4_configuration': {
        if (!args?.name || !args?.measurementId) throw new Error('name and measurementId are required');
        const created = await gtmManager.createGa4ConfigurationTag(
          args.name as string,
          args.measurementId as string,
          {
            sendPageView: typeof args.sendPageView === 'boolean' ? (args.sendPageView as boolean) : undefined,
            triggerType: (args.trigger as string) || 'pageview',
            fieldsToSet: (args.fieldsToSet as Record<string, string>) || undefined,
          }
        );
        return {
          content: [
            { type: 'text', text: `GA4 Configuration tag created!\nName: ${created.name}\nID: ${created.tagId}` },
          ],
        };
      }

      case 'gtm_create_ga4_event': {
        if (!args?.name || !args?.eventName) throw new Error('name and eventName are required');
        if (!args?.measurementId && !args?.configTagId) throw new Error('Provide either measurementId or configTagId');
        // Allow using `trigger` as either a type (e.g., 'pageview') or a numeric ID
        let triggerTypeOrId = (args.trigger as string) || 'pageview';
        let triggerId: string | undefined = args.triggerId as string | undefined;
        if (!triggerId && triggerTypeOrId && /^\d+$/.test(triggerTypeOrId)) {
          triggerId = triggerTypeOrId;
          triggerTypeOrId = 'custom'; // bypass auto pageview creation
        }
        const created = await gtmManager.createGa4EventTag(
          args.name as string,
          (args.measurementId as string | undefined),
          args.eventName as string,
          {
            eventParameters: (args.eventParameters as Record<string, any>) || undefined,
            triggerType: triggerTypeOrId || 'pageview',
            // Allow passing a specific trigger ID (e.g., Custom Event/Regex)
            ...(triggerId ? { triggerId } : {}),
            ...(args.configTagId ? { configTagId: args.configTagId as string } : {}),
            ...(typeof args.resolveVariables === 'boolean' ? { resolveVariables: Boolean(args.resolveVariables) } : {}),
          }
        );
        return {
          content: [
            { type: 'text', text: `GA4 Event tag created!\nName: ${created.name}\nID: ${created.tagId}` },
          ],
        };
      }


      case 'gtm_create_variable':
        if (!args?.name || !args?.code) throw new Error('Variable name and code are required');
        const newVariable = await gtmManager.createVariable(
          args.name as string, 
          args.code as string, 
          (args.type as string) || 'jsm'
        );
        return {
          content: [
            {
              type: 'text',
              text: `Variable created successfully!\nName: ${newVariable.name}\nID: ${newVariable.variableId}`,
            },
          ],
        };

      case 'gtm_create_dlv': {
        if (!args?.name || !args?.dlvName) throw new Error('name and dlvName are required');
        const v = await gtmManager.createDataLayerVariable(
          args.name as string,
          args.dlvName as string,
          (args.dataLayerVersion as number) === 1 ? 1 : 2,
          (args.defaultValue as string | undefined)
        );
        return {
          content: [
            { type: 'text', text: `DLV created!\nName: ${v.name}\nID: ${v.variableId}` },
          ],
        };
      }

      case 'gtm_delete_variable':
        if (!args?.variableId) throw new Error('Variable ID is required');
        const varResult = await gtmManager.deleteVariable(args.variableId as string);
        return {
          content: [
            {
              type: 'text',
              text: `Variable ${varResult.variableId} deleted successfully!`,
            },
          ],
        };

      case 'gtm_find_variables': {
        const gtmIdFind = (args?.gtmId as string) || process.env.GTM_ID;
        if (!gtmIdFind) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmIdFind);
        const nameQ = String(args?.name || '').trim();
        if (!nameQ) throw new Error('name is required');
        const exact = Boolean(args?.exact);
        const idsOnly = Boolean(args?.idsOnly);
        const matches = await gtmManager.findVariablesByName(nameQ, exact);
        const body = idsOnly
          ? matches.map((v: any) => v.variableId).join('\n')
          : matches.length
            ? `Found ${matches.length} variable(s):\n${matches.map((v: any) => `- ${v.name} (${v.type}) - ID: ${v.variableId}`).join('\n')}`
            : `No variables matched "${nameQ}"`;
        return { content: [{ type: 'text', text: body }] };
      }

      case 'gtm_validate_workspace': {
        const res = await gtmManager.validateWorkspace();
        const text = res.ok
          ? 'Workspace validation passed: no blocking issues detected.'
          : `Workspace validation found ${res.issues.length} issue(s):\n- ${res.issues.join('\n- ')}`;
        return { content: [{ type: 'text', text }], isError: res.ok ? false : true } as any;
      }

      case 'gtm_update_tag':
        if (!args?.tagId) throw new Error('Tag ID is required');
        const updatedTag = await gtmManager.updateTag(
          args.tagId as string,
          args.name as string | undefined,
          args.html as string | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: `Tag updated successfully!\nName: ${updatedTag.name}\nID: ${updatedTag.tagId}`,
            },
          ],
        };

      case 'gtm_update_variable':
        if (!args?.variableId) throw new Error('Variable ID is required');
        const updatedVariable = await gtmManager.updateVariable(
          args.variableId as string,
          args.name as string | undefined,
          args.code as string | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: `Variable updated successfully!\nName: ${updatedVariable.name}\nID: ${updatedVariable.variableId}`,
            },
          ],
        };

      case 'gtm_update_ga4_event_tag': {
        if (!args?.tagId) throw new Error('tagId is required');
        const updated = await gtmManager.updateGa4EventTag(
          args.tagId as string,
          {
            name: args.name as string | undefined,
            configTagId: args.configTagId as string | undefined,
            measurementId: args.measurementId as string | undefined,
            eventName: args.eventName as string | undefined,
            eventParameters: (args.eventParameters as Record<string, any>) || undefined,
            triggerId: args.triggerId as string | undefined,
            triggerType: args.trigger as string | undefined,
            resolveVariables: Boolean(args?.resolveVariables),
          }
        );
        return { content: [{ type: 'text', text: `GA4 Event updated!\nName: ${updated.name}\nID: ${updated.tagId}` }] };
      }

      case 'gtm_pause_tag': {
        if (!args?.tagId) throw new Error('tagId is required');
        const t = await gtmManager.pauseTag(args.tagId as string, true);
        return { content: [{ type: 'text', text: `Tag paused: ${t.name} (${t.tagId})` }] };
      }
      case 'gtm_unpause_tag': {
        if (!args?.tagId) throw new Error('tagId is required');
        const t = await gtmManager.pauseTag(args.tagId as string, false);
        return { content: [{ type: 'text', text: `Tag unpaused: ${t.name} (${t.tagId})` }] };
      }

      case 'gtm_list_versions': {
        const gtmId = process.env.GTM_ID;
        if (!gtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(gtmId);
        const resp = await (gtmManager as any).tagManager.accounts.containers.versions.list({ parent: `accounts/${(gtmManager as any).accountId}/containers/${(gtmManager as any).containerId}` });
        const versions = resp?.data?.containerVersion || resp?.data?.containerVersionHeader || resp?.data?.containerVersions || [];
        const lines = (versions || []).map((v: any) => `- ${v.name || '(no name)'}  id=${v.containerVersionId || v.containerVersionId || 'n/a'}  notes=${v.notes || ''}  created=${v.path || ''}`);
        return { content: [{ type: 'text', text: `Versions:\n${lines.join('\n')}` }] };
      }

      case 'gtm_create_custom_event_trigger': {
        if (!args?.name || !args?.eventName) throw new Error('name and eventName are required');
        const filter = Boolean(args.regex)
          ? [{ type: 'matchRegex', parameter: [{ type: 'template', key: 'arg0', value: 'event' }, { type: 'template', key: 'arg1', value: String(args.eventName) }] }]
          : [{ type: 'equals', parameter: [{ type: 'template', key: 'arg0', value: 'event' }, { type: 'template', key: 'arg1', value: String(args.eventName) }] }];
        const trig = await gtmManager.createTrigger(args.name as string, 'customEvent', filter as any[]);
        return { content: [{ type: 'text', text: `Custom Event trigger created!\nName: ${trig.name}\nID: ${trig.triggerId}` }] };
      }

      case 'gtm_list_triggers':
        const triggerGtmId = (args?.gtmId as string) || process.env.GTM_ID;
        if (!triggerGtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(triggerGtmId);
        const triggers = await gtmManager.listTriggers();
        if (args?.format === 'json') {
          const items = (triggers || []).map((t: any) => ({ id: t.triggerId, name: t.name, type: t.type }));
          return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, items }, null, 2) }] };
        }
        if (args?.idsOnly) {
          return { content: [{ type: 'text', text: (triggers || []).map((t: any) => t.triggerId).join('\n') }] };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Found ${triggers.length} triggers:\n${triggers
                .map((trigger: any) => `- ${trigger.name} [${trigger.type}] - ID: ${trigger.triggerId}`)
                .join('\n')}`,
            },
          ],
        };

      case 'gtm_create_trigger':
        if (!args?.name || !args?.type) throw new Error('Trigger name and type are required');
        const newTrigger = await gtmManager.createTrigger(
          args.name as string,
          args.type as string,
          args.conditions as any[] | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: `Trigger created successfully!\nName: ${newTrigger.name}\nID: ${newTrigger.triggerId}`,
            },
          ],
        };

      case 'gtm_delete_trigger':
        if (!args?.triggerId) throw new Error('Trigger ID is required');
        const triggerResult = await gtmManager.deleteTrigger(args.triggerId as string);
        return {
          content: [
            {
              type: 'text',
              text: `Trigger ${triggerResult.triggerId} deleted successfully!`,
            },
          ],
        };

      case 'gtm_create_version': {
        const res = await gtmManager.createVersion(args?.name as string | undefined, args?.notes as string | undefined);
        return {
          content: [
            {
              type: 'text',
              text: `Version created successfully!\nVersion ID: ${res.versionId || 'unknown'}`,
            },
          ],
        };
      }

      case 'gtm_publish_version': {
        if (!args?.versionId) throw new Error('versionId is required');
        await gtmManager.publishVersion(args.versionId as string);
        return {
          content: [
            {
              type: 'text',
              text: `Version ${args.versionId} published successfully!`,
            },
          ],
        };
      }

      case 'gtm_submit': {
        try {
          const res = await gtmManager.submit(args?.name as string | undefined, args?.notes as string | undefined);
          return { content: [{ type: 'text', text: `Submit successful!\nVersion ID: ${res.versionId}` }] };
        } catch (e: any) {
          const code = e?.code || e?.response?.status || 'unknown';
          const msg = e?.message || e?.response?.data || String(e);
          const path = gtmManager && (gtmManager as any).accountId && (gtmManager as any).containerId
            ? `accounts/${(gtmManager as any).accountId}/containers/${(gtmManager as any).containerId}`
            : '(unresolved container)';
          const scopes = ['https://www.googleapis.com/auth/tagmanager.readonly','https://www.googleapis.com/auth/tagmanager.edit.containers','https://www.googleapis.com/auth/tagmanager.edit.containerversions','https://www.googleapis.com/auth/tagmanager.publish'];
          const detail = `Submit failed (HTTP ${code}).\nPath: ${path}\nNeeded scopes: ${scopes.join(', ')}\nMessage: ${msg}`;
          return { content: [{ type: 'text', text: detail }], isError: true };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GTM Manager MCP Server running...');
}

if (process.env.MCP_NO_MAIN !== '1') {
  main().catch(console.error);
}
