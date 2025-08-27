import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle';
import { GTMManager } from '../index';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);

  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  const tagName = 'Unit Tag';
  const html = '<script>console.log("ok")</script>';
  const tag = await mgr.createTag(tagName, html, 'pageview');
  await expect(tag.name === tagName, 'createTag should return created tag');
  await expect(!!tag.tagId, 'createTag should return tagId');

  const list = await mgr.listTags();
  await expect(Array.isArray(list) && list.length === 1, 'listTags should include created tag');

  const del = await mgr.deleteTag(tag.tagId);
  await expect(del.deleted === true, 'deleteTag should confirm deletion');
}
