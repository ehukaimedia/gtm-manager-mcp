import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const before = await mgr.listTriggers();
  await expect(before.length === 0, 'no triggers initially');
  const trig = await mgr.createTrigger('Unit Trigger', 'pageview');
  await expect(!!trig.triggerId, 'createTrigger returns id');
  const after = await mgr.listTriggers();
  await expect(after.length === 1, 'listTriggers sees created');
  const del = await mgr.deleteTrigger(trig.triggerId);
  await expect(del.deleted === true, 'deleteTrigger confirms deletion');
}

