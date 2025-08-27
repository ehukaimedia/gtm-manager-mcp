import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle';
import { GTMManager } from '../index';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);

  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  const before = await mgr.listTriggers();
  await expect(before.length === 0, 'initial triggers should be empty');

  const trig = await mgr.createTrigger('Unit Trigger', 'pageview');
  await expect(trig.name === 'Unit Trigger', 'createTrigger returns created trigger');

  const afterCreate = await mgr.listTriggers();
  await expect(afterCreate.length === 1, 'listTriggers reflects created trigger');

  const res = await mgr.deleteTrigger(trig.triggerId);
  await expect(res.deleted === true, 'deleteTrigger confirms deletion');
}
