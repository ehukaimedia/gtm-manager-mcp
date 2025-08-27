import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const created = await mgr.createVersion('Unit Version', 'notes');
  await expect(!!created.versionId, 'createVersion returns id');
  const pub = await mgr.publishVersion(created.versionId);
  await expect(pub.ok === true, 'publishVersion returns ok');
}

