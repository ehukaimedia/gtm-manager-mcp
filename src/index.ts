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
    fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2));
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
      },
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
    name: 'gtm_list_triggers',
    description: 'List all triggers in the GTM container',
    inputSchema: {
      type: 'object',
      properties: {
        gtmId: {
          type: 'string',
          description: 'GTM container ID (optional, uses env default)',
        },
      },
    },
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
        return {
          content: [
            {
              type: 'text',
              text: `Found ${tags.length} tags:\n${tags
                .map((tag: any) => `- ${tag.name} (${tag.type}) - ID: ${tag.tagId}`)
                .join('\n')}`,
            },
          ],
        };

      case 'gtm_list_variables':
        const varGtmId = (args?.gtmId as string) || process.env.GTM_ID;
        if (!varGtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(varGtmId);
        const variables = await gtmManager.listVariables();
        return {
          content: [
            {
              type: 'text',
              text: `Found ${variables.length} variables:\n${variables
                .map((variable: any) => `- ${variable.name} (${variable.type}) - ID: ${variable.variableId}`)
                .join('\n')}`,
            },
          ],
        };

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

      case 'gtm_list_triggers':
        const triggerGtmId = (args?.gtmId as string) || process.env.GTM_ID;
        if (!triggerGtmId) throw new Error('GTM_ID not provided and not set in environment');
        await gtmManager.findContainer(triggerGtmId);
        const triggers = await gtmManager.listTriggers();
        return {
          content: [
            {
              type: 'text',
              text: `Found ${triggers.length} triggers:\n${triggers
                .map((trigger: any) => `- ${trigger.name} (${trigger.type}) - ID: ${trigger.triggerId}`)
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
        const res = await gtmManager.submit(args?.name as string | undefined, args?.notes as string | undefined);
        return {
          content: [
            {
              type: 'text',
              text: `Submit successful!\nVersion ID: ${res.versionId}`,
            },
          ],
        };
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
