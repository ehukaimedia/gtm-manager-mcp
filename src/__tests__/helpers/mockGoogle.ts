import { google as realGoogle } from 'googleapis';

export type MockTagManager = ReturnType<typeof createMockTagManager>;

export function createMockTagManager() {
  const state = {
    accountId: 'acc1',
    containerId: 'cont1',
    workspaceId: 'ws1',
    gtmId: 'GTM-TEST',
    triggers: [] as any[],
    tags: [] as any[],
    variables: [] as any[],
    versions: [] as any[],
  };

  const tm = {
    accounts: {
      list: async () => ({ data: { account: [{ accountId: state.accountId }] } }),
      containers: {
        list: async ({ parent }: any) => ({ data: { container: [{ publicId: state.gtmId, containerId: state.containerId }] } }),
        workspaces: {
          list: async () => ({ data: { workspace: [{ workspaceId: state.workspaceId }] } }),
          create_version: async ({ requestBody }: any) => {
            const id = String(state.versions.length + 1);
            const version = { containerVersionId: id, name: requestBody?.name, notes: requestBody?.notes };
            state.versions.push(version);
            return { data: { containerVersion: version } } as any;
          },
          tags: {
            list: async () => ({ data: { tag: state.tags.slice() } }),
            get: async ({ path }: any) => {
              const m = path.match(/\/tags\/(.+)$/);
              const id = m?.[1];
              const t = state.tags.find(x => x.tagId === id);
              return { data: { ...t } };
            },
            create: async ({ requestBody }: any) => {
              const id = String(state.tags.length + 1);
              const tag = { tagId: id, name: requestBody.name, type: requestBody.type, parameter: requestBody.parameter, firingTriggerId: requestBody.firingTriggerId };
              state.tags.push(tag);
              return { data: tag };
            },
            update: async ({ requestBody, path }: any) => {
              const m = path.match(/\/tags\/(.+)$/);
              const id = m?.[1];
              const idx = state.tags.findIndex(x => x.tagId === id);
              if (idx >= 0) state.tags[idx] = { ...state.tags[idx], ...requestBody };
              return { data: state.tags[idx] };
            },
            delete: async ({ path }: any) => {
              const m = path.match(/\/tags\/(.+)$/);
              const id = m?.[1];
              state.tags = state.tags.filter(x => x.tagId !== id);
              return {} as any;
            },
          },
          variables: {
            list: async () => ({ data: { variable: state.variables.slice() } }),
            get: async ({ path }: any) => {
              const m = path.match(/\/variables\/(.+)$/);
              const id = m?.[1];
              const v = state.variables.find(x => x.variableId === id);
              return { data: { ...v } };
            },
            create: async ({ requestBody }: any) => {
              const id = String(state.variables.length + 1);
              const variable = { variableId: id, name: requestBody.name, type: requestBody.type, parameter: requestBody.parameter };
              state.variables.push(variable);
              return { data: variable };
            },
            update: async ({ requestBody, path }: any) => {
              const m = path.match(/\/variables\/(.+)$/);
              const id = m?.[1];
              const idx = state.variables.findIndex(x => x.variableId === id);
              if (idx >= 0) state.variables[idx] = { ...state.variables[idx], ...requestBody };
              return { data: state.variables[idx] };
            },
            delete: async ({ path }: any) => {
              const m = path.match(/\/variables\/(.+)$/);
              const id = m?.[1];
              state.variables = state.variables.filter(x => x.variableId !== id);
              return {} as any;
            },
          },
          triggers: {
            list: async () => ({ data: { trigger: state.triggers.slice() } }),
            get: async ({ path }: any) => {
              const m = path.match(/\/triggers\/(.+)$/);
              const id = m?.[1];
              const t = state.triggers.find(x => x.triggerId === id);
              return { data: { ...t } };
            },
            create: async ({ requestBody }: any) => {
              const id = String(state.triggers.length + 1);
              const trigger = { triggerId: id, name: requestBody.name, type: requestBody.type, filter: requestBody.filter };
              state.triggers.push(trigger);
              return { data: trigger };
            },
            update: async ({ requestBody, path }: any) => {
              const m = path.match(/\/triggers\/(.+)$/);
              const id = m?.[1];
              const idx = state.triggers.findIndex(x => x.triggerId === id);
              if (idx >= 0) state.triggers[idx] = { ...state.triggers[idx], ...requestBody };
              return { data: state.triggers[idx] };
            },
            delete: async ({ path }: any) => {
              const m = path.match(/\/triggers\/(.+)$/);
              const id = m?.[1];
              state.triggers = state.triggers.filter(x => x.triggerId !== id);
              return {} as any;
            },
          },
        },
      },
      versions: {
        publish: async ({ path }: any) => ({ data: { ok: true } }),
      },
    },
  } as any;

  return { state, tm };
}

export function installGoogleMocks(mock: MockTagManager) {
  (realGoogle as any).tagmanager = (_opts: any) => mock.tm;
  (realGoogle as any).auth = {
    OAuth2: class {
      constructor(public clientId?: string, public secret?: string, public redirect?: string) {}
      setCredentials(_tokens: any) {}
    },
  } as any;
}

export function setTestEnv() {
  process.env.MCP_NO_MAIN = '1';
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'x';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'y';
  process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost';
  process.env.GTM_ID = process.env.GTM_ID || 'GTM-TEST';
}

export async function expect(cond: any, message: string) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

