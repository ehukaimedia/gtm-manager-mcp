import { google as realGoogle } from 'googleapis';

export function createMockTagManager() {
  const state = {
    accountId: 'acc1',
    containerId: 'cont1',
    workspaceId: 'ws1',
    gtmId: 'GTM-TEST',
    triggers: [],
    tags: [],
    variables: [],
    versions: [],
  };

  const tm = {
    accounts: {
      list: async () => ({ data: { account: [{ accountId: state.accountId }] } }),
      containers: {
        list: async () => ({ data: { container: [{ publicId: state.gtmId, containerId: state.containerId }] } }),
        workspaces: {
          list: async () => ({ data: { workspace: [{ workspaceId: state.workspaceId }] } }),
          create_version: async ({ requestBody }) => {
            const id = String(state.versions.length + 1);
            const version = { containerVersionId: id, name: requestBody?.name, notes: requestBody?.notes };
            state.versions.push(version);
            return { data: { containerVersion: version } };
          },
          tags: {
            list: async () => ({ data: { tag: state.tags.slice() } }),
            get: async ({ path }) => {
              const id = path.match(/\/tags\/(.+)$/)?.[1];
              const t = state.tags.find(x => x.tagId === id);
              return { data: { ...t } };
            },
            create: async ({ requestBody }) => {
              const id = String(state.tags.length + 1);
              const tag = { tagId: id, name: requestBody.name, type: requestBody.type, parameter: requestBody.parameter, firingTriggerId: requestBody.firingTriggerId };
              state.tags.push(tag);
              return { data: tag };
            },
            update: async ({ requestBody, path }) => {
              const id = path.match(/\/tags\/(.+)$/)?.[1];
              const idx = state.tags.findIndex(x => x.tagId === id);
              if (idx >= 0) state.tags[idx] = { ...state.tags[idx], ...requestBody };
              return { data: state.tags[idx] };
            },
            delete: async ({ path }) => {
              const id = path.match(/\/tags\/(.+)$/)?.[1];
              state.tags = state.tags.filter(x => x.tagId !== id);
              return {};
            },
          },
          variables: {
            list: async () => ({ data: { variable: state.variables.slice() } }),
            get: async ({ path }) => {
              const id = path.match(/\/variables\/(.+)$/)?.[1];
              const v = state.variables.find(x => x.variableId === id);
              return { data: { ...v } };
            },
            create: async ({ requestBody }) => {
              const id = String(state.variables.length + 1);
              const variable = { variableId: id, name: requestBody.name, type: requestBody.type, parameter: requestBody.parameter };
              state.variables.push(variable);
              return { data: variable };
            },
            update: async ({ requestBody, path }) => {
              const id = path.match(/\/variables\/(.+)$/)?.[1];
              const idx = state.variables.findIndex(x => x.variableId === id);
              if (idx >= 0) state.variables[idx] = { ...state.variables[idx], ...requestBody };
              return { data: state.variables[idx] };
            },
            delete: async ({ path }) => {
              const id = path.match(/\/variables\/(.+)$/)?.[1];
              state.variables = state.variables.filter(x => x.variableId !== id);
              return {};
            },
          },
          triggers: {
            list: async () => ({ data: { trigger: state.triggers.slice() } }),
            get: async ({ path }) => {
              const id = path.match(/\/triggers\/(.+)$/)?.[1];
              const t = state.triggers.find(x => x.triggerId === id);
              return { data: { ...t } };
            },
            create: async ({ requestBody }) => {
              const id = String(state.triggers.length + 1);
              const trigger = { triggerId: id, name: requestBody.name, type: requestBody.type, filter: requestBody.filter };
              state.triggers.push(trigger);
              return { data: trigger };
            },
            update: async ({ requestBody, path }) => {
              const id = path.match(/\/triggers\/(.+)$/)?.[1];
              const idx = state.triggers.findIndex(x => x.triggerId === id);
              if (idx >= 0) state.triggers[idx] = { ...state.triggers[idx], ...requestBody };
              return { data: state.triggers[idx] };
            },
            delete: async ({ path }) => {
              const id = path.match(/\/triggers\/(.+)$/)?.[1];
              state.triggers = state.triggers.filter(x => x.triggerId !== id);
              return {};
            },
          },
        },
        versions: {
          publish: async () => ({ data: { ok: true } }),
        },
      },
    },
  };

  return { state, tm };
}

export function installGoogleMocks(mock) {
  realGoogle.tagmanager = () => mock.tm;
  realGoogle.auth = {
    OAuth2: class {
      constructor() {}
      setCredentials() {}
    },
  };
}

export function setTestEnv() {
  process.env.MCP_NO_MAIN = '1';
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'x';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'y';
  process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost';
  process.env.GTM_ID = process.env.GTM_ID || 'GTM-TEST';
}

export function expect(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}
