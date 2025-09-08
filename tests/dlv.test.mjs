import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const v = await mgr.createDataLayerVariable('DLV Page Path', 'page.path', 2, '/');
  await expect(v.type === 'v', 'DLV variable type is v');
  await expect(v.name === 'DLV Page Path', 'DLV created with correct name');
}

