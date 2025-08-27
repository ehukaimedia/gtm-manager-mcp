import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle';
import { GTMManager } from '../index';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);

  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  const created = await mgr.createVersion('Unit Version', 'notes');
  await expect(!!created.versionId, 'createVersion returns versionId');

  const pub = await mgr.publishVersion(created.versionId as string);
  await expect((pub as any).ok === true, 'publishVersion returns ok');
}
