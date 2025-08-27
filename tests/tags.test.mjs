import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const tag = await mgr.createTag('Unit Tag', '<script>1</script>', 'pageview');
  await expect(tag.name === 'Unit Tag', 'createTag returns created tag');
  const list = await mgr.listTags();
  await expect(list.length === 1, 'listTags includes created tag');
  const del = await mgr.deleteTag(tag.tagId);
  await expect(del.deleted === true, 'deleteTag confirms deletion');
}

