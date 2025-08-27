import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle';
import { GTMManager } from '../index';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);

  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  const res = await mgr.submit('Unit Submit', 'testing submit');
  await expect(!!res.versionId, 'submit returns versionId');
  await expect(res.versionId === '1', 'submit creates first version as id=1');
}
